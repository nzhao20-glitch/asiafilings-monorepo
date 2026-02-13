'use client';

import { useEffect, useRef } from 'react';
import { pdfjs } from 'react-pdf';

interface CustomTextLayerProps {
  page: any; // PDFPageProxy
  scale: number;
  canvasRenderComplete: boolean;
  searchQuery?: string;
}

/**
 * Post-render scaleX correction for residual width drift.
 *
 * Even with embedded fonts, ctx.measureText() on a hidden canvas can differ
 * slightly from actual DOM text layout (sub-pixel rounding, DPR scaling,
 * font hinting). This function re-measures actual DOM widths and corrects
 * scaleX to match the PDF's expected text content widths.
 */
function fixSpanWidths(
  textDivs: HTMLElement[],
  textItems: Array<{ str?: string; width?: number; type?: string }>,
  scale: number
) {
  const items = textItems.filter(item => item.str !== undefined);

  for (let i = 0; i < textDivs.length && i < items.length; i++) {
    const span = textDivs[i];
    const item = items[i];

    if (!item.str || item.str.length <= 1 || !item.width) continue;

    const expectedWidth = item.width * scale;
    const rect = span.getBoundingClientRect();
    if (rect.width <= 0 || expectedWidth <= 0) continue;

    const correction = expectedWidth / rect.width;
    if (Math.abs(correction - 1) < 0.002) continue;

    const transform = span.style.transform;
    const match = transform.match(/scaleX\(([^)]+)\)/);
    if (match) {
      const newScaleX = parseFloat(match[1]) * correction;
      span.style.transform = transform.replace(/scaleX\([^)]+\)/, `scaleX(${newScaleX})`);
    } else if (transform) {
      span.style.transform = `scaleX(${correction}) ${transform}`;
    } else {
      span.style.transform = `scaleX(${correction})`;
    }
  }
}

/**
 * Highlight search matches directly on text layer spans.
 *
 * Splits each span's text so only the matching substring(s) are wrapped
 * in <mark> elements, preserving the span's positioning and transforms.
 */
function highlightSearchMatches(
  textDivs: HTMLElement[],
  textContentItemsStr: string[],
  query: string,
) {
  if (!query || query.length < 2) return;

  const queryLower = query.toLowerCase();

  // Build concatenated text with span boundary tracking (mirrors performSearch)
  let fullText = '';
  const spanRanges: { start: number; end: number; idx: number }[] = [];

  for (let i = 0; i < textDivs.length && i < textContentItemsStr.length; i++) {
    const str = textContentItemsStr[i];
    const start = fullText.length;
    fullText += str + ' ';
    spanRanges.push({ start, end: start + str.length, idx: i });
  }

  // Find all matches and collect per-span highlight ranges (local offsets)
  const spanHighlights: Map<number, { from: number; to: number }[]> = new Map();
  const fullTextLower = fullText.toLowerCase();
  let searchIdx = 0;

  while ((searchIdx = fullTextLower.indexOf(queryLower, searchIdx)) !== -1) {
    const matchEnd = searchIdx + queryLower.length;

    for (const range of spanRanges) {
      if (range.start >= matchEnd) break;
      if (range.end <= searchIdx) continue;

      // Clamp match range to this span's local text
      const localFrom = Math.max(0, searchIdx - range.start);
      const localTo = Math.min(range.end - range.start, matchEnd - range.start);

      if (!spanHighlights.has(range.idx)) spanHighlights.set(range.idx, []);
      spanHighlights.get(range.idx)!.push({ from: localFrom, to: localTo });
    }

    searchIdx += queryLower.length;
  }

  // For each span with highlights, split its textContent into fragments
  for (const [idx, ranges] of spanHighlights) {
    const span = textDivs[idx];
    const text = textContentItemsStr[idx];
    if (!text) continue;

    // Merge overlapping ranges
    const merged = mergeRanges(ranges);

    // Build fragment nodes
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { from, to } of merged) {
      if (from > pos) frag.appendChild(document.createTextNode(text.slice(pos, from)));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = text.slice(from, to);
      frag.appendChild(mark);
      pos = to;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));

    span.textContent = '';
    span.appendChild(frag);
  }
}

/** Merge overlapping/adjacent highlight ranges. */
function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].from <= last.to) {
      last.to = Math.max(last.to, sorted[i].to);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

/**
 * Custom text layer that renders AFTER canvas completion, using the actual
 * PDF-embedded fonts for accurate text-to-canvas alignment.
 *
 * Key fixes over react-pdf's built-in TextLayer:
 *
 * 1. Deferred rendering: waits for canvas completion + font loading so
 *    @font-face fonts injected during canvas rendering are available.
 *
 * 2. Embedded font usage: pdfjs TextLayer defaults to generic families
 *    ("serif", "sans-serif") for text spans, but the canvas renders with
 *    the actual PDF fonts loaded as @font-face rules. This mismatch causes
 *    ctx.measureText() to compute wrong scaleX values (5-14% drift).
 *    We patch textContent.styles to use the @font-face loadedName so both
 *    measurement and rendering use the same embedded font.
 *
 * 3. Search highlighting: applies highlight CSS directly to text layer spans
 *    for pixel-perfect search result highlighting (no coordinate conversion).
 *
 * IMPORTANT: This component must be rendered as a child of react-pdf's
 * <Page> component so it inherits --scale-factor and positions correctly
 * via the .textLayer { inset: 0 } CSS rule.
 */
export function CustomTextLayer({ page, scale, canvasRenderComplete, searchQuery }: CustomTextLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRenderComplete || !page || !containerRef.current) return;

    const container = containerRef.current;

    // Clean up any previous render
    container.innerHTML = '';

    const viewport = page.getViewport({ scale });

    let cancelled = false;

    const renderTextLayer = async () => {
      try {
        // Wait for all @font-face fonts to be loaded by the browser.
        await document.fonts.ready;
        if (cancelled) return;

        // Wait one animation frame to ensure font face rules are fully processed
        await new Promise(resolve => requestAnimationFrame(resolve));
        await document.fonts.ready;
        if (cancelled) return;

        // Clear stale ascent cache (measured with fallback fonts by any earlier TextLayer)
        pdfjs.TextLayer.cleanup();

        const textContent = await page.getTextContent({ includeMarkedContent: true });
        if (cancelled) return;

        // Patch font families to use actual PDF-embedded @font-face fonts.
        for (const [loadedName, style] of Object.entries(textContent.styles)) {
          const s = style as any;
          if (document.fonts.check(`12px "${loadedName}"`)) {
            s.fontFamily = `"${loadedName}", ${s.fontFamily}`;
          }
        }

        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        });

        // Override CSS calc dimensions with exact pixel values matching canvas
        container.style.width = `${Math.floor(viewport.width)}px`;
        container.style.height = `${Math.floor(viewport.height)}px`;

        textLayerRef.current = textLayer;
        await textLayer.render();
        if (cancelled) return;

        // Post-render scaleX correction for any residual measurement drift
        fixSpanWidths(textLayer.textDivs, textContent.items, scale);

        // Highlight search matches directly on text layer spans
        if (searchQuery) {
          highlightSearchMatches(
            textLayer.textDivs,
            textLayer.textContentItemsStr,
            searchQuery,
          );
        }

        // Add endOfContent div for proper text selection behavior
        const end = document.createElement('div');
        end.className = 'endOfContent';
        container.append(end);
      } catch (err: any) {
        if (err?.name === 'AbortException' || cancelled) return;
        console.error('CustomTextLayer render error:', err);
      }
    };

    renderTextLayer();

    return () => {
      cancelled = true;
      if (textLayerRef.current) {
        textLayerRef.current.cancel();
        textLayerRef.current = null;
      }
      container.innerHTML = '';
    };
  }, [page, scale, canvasRenderComplete, searchQuery]);

  if (!canvasRenderComplete) return null;

  return (
    <div
      ref={containerRef}
      className="textLayer react-pdf__Page__textContent"
    />
  );
}
