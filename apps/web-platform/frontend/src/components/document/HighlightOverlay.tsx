'use client';

interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HighlightOverlayProps {
  rects: HighlightRect[];
  pageWidth: number;
  pageHeight: number;
  renderScale: number;
}

/**
 * Convert stored 1x PDF coordinates to screen pixels
 *
 * Coordinates are stored in 1x PDF space (screenPixels / actualRenderScale).
 * Multiply by renderScale to get screen pixel positions.
 */
function convertRectToScreen(
  rect: HighlightRect,
  renderScale: number,
) {
  return {
    left: rect.x * renderScale,
    top: rect.y * renderScale,
    width: rect.width * renderScale,
    height: rect.height * renderScale,
  };
}

/**
 * HighlightOverlay - Renders highlight rectangles for selected text
 *
 * Uses coordinate-based highlighting (no text matching needed)
 * Supports multi-line selections with multiple rectangles
 * Highlights are rendered as semi-transparent yellow overlays
 */
export function HighlightOverlay({
  rects,
  pageWidth,
  pageHeight,
  renderScale,
}: HighlightOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none', // Allow clicks to pass through
      }}
    >
      {rects.map((rect, idx) => {
        const screenRect = convertRectToScreen(rect, renderScale);

        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              left: `${screenRect.left}px`,
              top: `${screenRect.top}px`,
              width: `${screenRect.width}px`,
              height: `${screenRect.height}px`,
              backgroundColor: '#ffd700', // Gold/yellow
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </div>
  );
}
