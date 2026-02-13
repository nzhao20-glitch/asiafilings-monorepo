'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { List } from 'react-window';
import { HighlightOverlay } from '@/src/components/document/HighlightOverlay';
import { encodeHighlight } from '@/src/utils/highlight-encoding';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DISPLAY_SCALE = 1.3;
const ESTIMATED_PAGE_HEIGHT = 842 * DISPLAY_SCALE; // ~1095px
const TARGET_DISPLAY_WIDTH = 595 * DISPLAY_SCALE;  // ~774px
const PAGE_GAP = 8;

const copyToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch {
    console.error('Clipboard copy failed');
    return false;
  }
};

/**
 * Memoized search page component.
 * Text layer is left untouched - search highlights are rendered as overlays.
 */
const SearchPageMemo = memo(({
  pageNumber,
  pdfScale,
}: {
  pageNumber: number;
  pdfScale: number;
}) => {
  return (
    <Page
      pageNumber={pageNumber}
      scale={pdfScale}
      renderTextLayer={true}
      renderAnnotationLayer={false}
    />
  );
});
SearchPageMemo.displayName = 'SearchPageMemo';

interface SearchPDFViewerProps {
  pdfUrl: string;
  matchedPages: number[];
  query: string;
  scale?: number;
  documentId: string;
  scrollToPageRef: React.MutableRefObject<((pageNumber: number) => void) | null>;
}

export function SearchPDFViewer({ pdfUrl, matchedPages, query, scale = DISPLAY_SCALE, documentId, scrollToPageRef }: SearchPDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const [heightsReady, setHeightsReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectionPopup, setSelectionPopup] = useState<{
    show: boolean;
    x: number;
    y: number;
    text: string;
    pageNumber: number;
    rects: Array<{ x: number; y: number; width: number; height: number }>;
  }>({ show: false, x: 0, y: 0, text: '', pageNumber: 1, rects: [] });
  const [linkCopied, setLinkCopied] = useState(false);
  const [searchHighlights, setSearchHighlights] = useState<Record<number, Array<{ x: number; y: number; width: number; height: number }>>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const pageHeightsRef = useRef<Record<number, number>>({});
  const pdfDocRef = useRef<any>(null);
  const searchHighlightsRef = useRef<Record<number, Array<{ x: number; y: number; width: number; height: number }>>>({});

  // Track container size with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Row height function — uses ref for stability
  const getRowHeight = useCallback((index: number) => {
    const pageNum = index + 1;
    const actual = pageHeightsRef.current[pageNum];
    return (actual || ESTIMATED_PAGE_HEIGHT) + PAGE_GAP;
  }, []);

  // Expose scrollToPage via ref
  useEffect(() => {
    scrollToPageRef.current = (pageNumber: number) => {
      if (!listRef.current) return;

      const targetIndex = pageNumber - 1;
      let scrollTop = 0;
      for (let i = 0; i < targetIndex; i++) {
        scrollTop += getRowHeight(i);
      }

      // If we have search highlights for this page, scroll to the first match
      const pageHighlights = searchHighlightsRef.current[pageNumber];
      if (pageHighlights && pageHighlights.length > 0) {
        // Find the topmost highlight on the page
        const topmost = pageHighlights.reduce((min, h) => h.y < min.y ? h : min, pageHighlights[0]);
        // Convert 1x PDF y-coordinate to screen pixels
        scrollTop += topmost.y * DISPLAY_SCALE;

        // Center the match vertically in the viewport
        const scrollElement = listRef.current.element;
        if (scrollElement) {
          scrollTop = Math.max(0, scrollTop - scrollElement.clientHeight / 3);
        }
      }

      const scrollElement = listRef.current.element;
      if (scrollElement) {
        scrollElement.scrollTop = scrollTop;
      }
    };

    return () => {
      scrollToPageRef.current = null;
    };
  }, [scrollToPageRef, getRowHeight]);

  // Reset state when PDF URL changes
  useEffect(() => {
    setNumPages(null);
    setIsLoading(true);
    setError(null);
    setPageHeights({});
    setHeightsReady(false);
    setSearchHighlights({});
    pageHeightsRef.current = {};
    searchHighlightsRef.current = {};
    pdfDocRef.current = null;
  }, [pdfUrl]);

  // Handle text selection popup
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0 && selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const clientRects = Array.from(range.getClientRects());

        if (clientRects.length > 0) {
          const startContainer = range.startContainer;
          const parentElement = (startContainer.nodeType === Node.ELEMENT_NODE
            ? startContainer as HTMLElement
            : startContainer.parentElement);
          const pageElement = parentElement?.closest('[data-page-number]') as HTMLElement;

          // Only handle selections inside this viewer
          if (pageElement && containerRef.current?.contains(pageElement)) {
            const pageNum = pageElement.getAttribute('data-page-number');
            if (pageNum) {
              const pageNumber = parseInt(pageNum, 10);
              const pageRect = pageElement.getBoundingClientRect();

              // Convert client rects to 1x PDF coordinates by dividing by DISPLAY_SCALE
              const pdfRects = clientRects.map(rect => ({
                x: (rect.left - pageRect.left) / DISPLAY_SCALE,
                y: (rect.top - pageRect.top) / DISPLAY_SCALE,
                width: rect.width / DISPLAY_SCALE,
                height: rect.height / DISPLAY_SCALE,
              }));

              const firstRect = clientRects[0];
              setSelectionPopup({
                show: true,
                x: firstRect.left + firstRect.width / 2,
                y: firstRect.top - 10,
                text: selectedText,
                pageNumber,
                rects: pdfRects,
              });
            }
          }
        }
      } else {
        setSelectionPopup(prev => prev.show ? { show: false, x: 0, y: 0, text: '', pageNumber: 1, rects: [] } : prev);
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // Copy shareable link with highlight
  const handleCopyLink = useCallback(() => {
    const encoded = encodeHighlight(selectionPopup.pageNumber, selectionPopup.rects);
    if (!encoded) return;

    const shareUrl = `${window.location.origin}/filings/${documentId}?h=${encoded}`;
    copyToClipboard(shareUrl).then((success) => {
      if (success) {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      }
    });
  }, [selectionPopup, documentId]);

  // Auto-scroll to first matched page once layout is ready after PDF load
  useEffect(() => {
    if (heightsReady && matchedPages.length > 0) {
      requestAnimationFrame(() => {
        scrollToPageRef.current?.(matchedPages[0]);
      });
    }
  }, [heightsReady, layoutVersion, matchedPages, scrollToPageRef]);

  const onDocumentLoadSuccess = useCallback(async (pdf: any) => {
    pdfDocRef.current = pdf;
    setNumPages(pdf.numPages);
    setIsLoading(false);
    setError(null);

    // Pre-calculate all page heights
    try {
      const heights: Record<number, number> = {};
      const pagePromises = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        pagePromises.push(
          pdf.getPage(i).then((page: any) => {
            const viewport = page.getViewport({ scale });
            const scaleFactor = TARGET_DISPLAY_WIDTH / viewport.width;
            heights[i] = viewport.height * scaleFactor;
          })
        );
      }

      await Promise.all(pagePromises);

      setPageHeights(heights);
      pageHeightsRef.current = heights;

      setTimeout(() => {
        if (listRef.current && typeof listRef.current.resetAfterIndex === 'function') {
          listRef.current.resetAfterIndex(0);
        }
        setHeightsReady(true);
        setLayoutVersion(v => v + 1);
      }, 50);
    } catch (err) {
      console.error('Failed to pre-calculate page heights:', err);
      setHeightsReady(true);
    }
  }, [scale, matchedPages]);

  const onDocumentLoadError = useCallback((err: Error) => {
    setIsLoading(false);
    setError(`Failed to load PDF: ${err.message}`);
    console.error('PDF load error:', err, 'URL:', pdfUrl);
  }, [pdfUrl]);

  // Compute search highlight rectangles from text item transforms
  useEffect(() => {
    if (!pdfDocRef.current || !query || query.length < 1 || !numPages) {
      searchHighlightsRef.current = {};
      setSearchHighlights({});
      return;
    }

    let cancelled = false;

    const computeHighlights = async () => {
      const highlights: Record<number, Array<{ x: number; y: number; width: number; height: number }>> = {};
      const searchLower = query.toLowerCase();

      try {
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          if (cancelled) return;

          const page = await pdfDocRef.current.getPage(pageNum);
          const textContent = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1.0 });

          let fullText = '';
          const itemPositions: { start: number; item: any }[] = [];

          textContent.items.forEach((item: any) => {
            if (item.str) {
              const start = fullText.length;
              fullText += item.str + ' ';
              itemPositions.push({ start, item });
            }
          });

          const fullTextLower = fullText.toLowerCase();
          let searchIndex = 0;
          const pageRects: Array<{ x: number; y: number; width: number; height: number }> = [];

          while ((searchIndex = fullTextLower.indexOf(searchLower, searchIndex)) !== -1) {
            const matchEnd = searchIndex + searchLower.length;

            for (const { start, item } of itemPositions) {
              const itemText = item.str as string;
              if (!itemText) continue;
              const itemStrEnd = start + itemText.length;

              if (start >= matchEnd || itemStrEnd <= searchIndex) continue;

              const fontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
              const pdfX = item.transform[4];
              const pdfY = item.transform[5];
              const itemWidth = item.width;

              const overlapStart = Math.max(searchIndex, start) - start;
              const overlapEnd = Math.min(matchEnd, itemStrEnd) - start;

              if (overlapStart >= overlapEnd) continue;

              const xOffset = (overlapStart / itemText.length) * itemWidth;
              const matchWidth = ((overlapEnd - overlapStart) / itemText.length) * itemWidth;

              pageRects.push({
                x: pdfX + xOffset,
                y: viewport.height - pdfY - fontSize,
                width: matchWidth,
                height: fontSize,
              });
            }

            searchIndex += searchLower.length;
          }

          if (pageRects.length > 0) {
            highlights[pageNum] = pageRects;
          }
        }

        if (!cancelled) {
          searchHighlightsRef.current = highlights;
          setSearchHighlights(highlights);
        }
      } catch (error) {
        console.error('Failed to compute search highlights:', error);
      }
    };

    computeHighlights();

    return () => { cancelled = true; };
  }, [query, numPages]);

  // Row component — renders a single page with overlay-based search highlights
  const Row = useCallback((props: {
    index: number;
    style: React.CSSProperties;
    ariaAttributes: any;
    pdfScale: number;
    searchHighlights: Record<number, Array<{ x: number; y: number; width: number; height: number }>>;
  }) => {
    const pageNum = props.index + 1;
    const pageSearchHighlights = props.searchHighlights[pageNum];

    return (
      <div style={{ ...props.style, display: 'flex', justifyContent: 'center' }} {...props.ariaAttributes}>
        <div className="relative shadow-md" style={{ width: 'fit-content' }}>
          <div style={{ position: 'relative', display: 'inline-block' }} data-page-number={pageNum}>
            <SearchPageMemo
              pageNumber={pageNum}
              pdfScale={props.pdfScale}
            />

            {pageSearchHighlights && pageSearchHighlights.length > 0 && (
              <HighlightOverlay
                rects={pageSearchHighlights}
                pageWidth={TARGET_DISPLAY_WIDTH}
                pageHeight={ESTIMATED_PAGE_HEIGHT}
                renderScale={DISPLAY_SCALE}
              />
            )}
          </div>
        </div>
      </div>
    );
  }, []);

  const rowProps = useMemo(() => ({
    pdfScale: scale,
    searchHighlights,
  }), [scale, searchHighlights]) as any;

  return (
    <div ref={containerRef} className="h-full w-full bg-gray-100">
      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-3 border-blue-200 border-t-blue-600 mx-auto mb-3"></div>
            <p className="text-sm text-gray-500">Loading PDF...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg m-4">
          {error}
        </div>
      )}

      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={null}
      >
        {numPages && containerSize.height > 0 && heightsReady && (
          <List
            key={`search-pdf-${layoutVersion}`}
            listRef={listRef}
            rowComponent={Row}
            rowCount={numPages}
            rowHeight={getRowHeight}
            rowProps={rowProps}
            style={{ height: containerSize.height, width: containerSize.width }}
            overscanCount={2}
          />
        )}
      </Document>

      {/* Text Selection Popup */}
      {selectionPopup.show && (
        <div
          className="fixed z-[300] bg-white rounded-lg shadow-xl border border-gray-200 px-2 py-1 flex items-center gap-2"
          style={{
            left: `${selectionPopup.x}px`,
            top: `${selectionPopup.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <button
            onClick={() => { copyToClipboard(selectionPopup.text); }}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Copy text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded transition-colors"
            title="Copy shareable link"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Copy Link
          </button>
        </div>
      )}

      {/* Link Copied Toast */}
      {linkCopied && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-[400] bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Link copied to clipboard!</span>
        </div>
      )}
    </div>
  );
}
