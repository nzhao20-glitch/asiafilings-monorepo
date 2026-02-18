'use client';

import { useEffect, useRef, useState } from 'react';
import { documentOcrApi, type OcrBbox } from '@/src/services/api';

interface OcrTextLayerProps {
  docId: string;
  pageNumber: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
  searchQuery?: string;
}

/**
 * OCR-based text layer for "broken" pages where PDF.js text extraction fails.
 *
 * Fetches word-level bounding boxes from the backend and renders transparent
 * <span> elements positioned to match the PDF canvas. Supports native text
 * selection, copy-paste, and search highlighting.
 *
 * Coordinates from the backend are in PDF points (72 DPI, origin top-left).
 * We multiply by `scale` to convert to screen pixels.
 */
export function OcrTextLayer({
  docId,
  pageNumber,
  scale,
  viewportWidth,
  viewportHeight,
  searchQuery,
}: OcrTextLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bboxes, setBboxes] = useState<OcrBbox[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    documentOcrApi.getOcrBboxes(docId, pageNumber).then((data) => {
      if (!cancelled) setBboxes(data);
    }).catch((err) => {
      if (!cancelled) {
        console.error(`OcrTextLayer: failed to fetch bboxes for page ${pageNumber}:`, err);
        setError(true);
      }
    });

    return () => { cancelled = true; };
  }, [docId, pageNumber]);

  if (error || bboxes === null) return (
    <div
      ref={containerRef}
      className="textLayer react-pdf__Page__textContent"
      style={{
        width: `${Math.floor(viewportWidth)}px`,
        height: `${Math.floor(viewportHeight)}px`,
      }}
    />
  );

  const queryLower = searchQuery?.toLowerCase();

  return (
    <div
      ref={containerRef}
      className="textLayer react-pdf__Page__textContent"
      style={{
        width: `${Math.floor(viewportWidth)}px`,
        height: `${Math.floor(viewportHeight)}px`,
      }}
    >
      {bboxes.map((bbox, i) => {
        const left = bbox.x0 * scale;
        const top = bbox.y0 * scale;
        const width = (bbox.x1 - bbox.x0) * scale;
        const height = (bbox.y1 - bbox.y0) * scale;

        const isHighlighted = queryLower && queryLower.length >= 2 &&
          bbox.word.toLowerCase().includes(queryLower);

        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              fontSize: `${height * 0.9}px`,
              fontFamily: 'sans-serif',
              color: 'transparent',
              lineHeight: 1,
              whiteSpace: 'pre',
              cursor: 'text',
            }}
          >
            {isHighlighted ? (
              <mark className="search-highlight">{bbox.word}</mark>
            ) : (
              bbox.word
            )}
          </span>
        );
      })}
      <div className="endOfContent" />
    </div>
  );
}
