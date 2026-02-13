/**
 * Utilities for encoding/decoding text highlight data in URLs
 *
 * Format: Compact array [page, x1, y1, w1, h1, x2, y2, w2, h2, ...]
 * Encoding: JSON → Base64 (URL-safe)
 *
 * Example URL: /filings/123?h=WzUsNTAuMCwyMDAuMCw0MDAuMCwxNS4wLDUwLjAs...
 */

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HighlightData {
  pageNumber: number;
  rects: HighlightRect[];
}

/**
 * Encode highlight data into URL-safe base64 string
 *
 * @param pageNumber - PDF page number (1-indexed)
 * @param rects - Array of highlight rectangles in PDF coordinates
 * @returns URL-safe base64 encoded string
 */
export function encodeHighlight(pageNumber: number, rects: HighlightRect[]): string {
  // Compact array format: [page, x1, y1, w1, h1, x2, y2, w2, h2, ...]
  // Round coordinates to 1 decimal place to reduce URL length
  const compact = [
    pageNumber,
    ...rects.flatMap(r => [
      Math.round(r.x * 10) / 10,
      Math.round(r.y * 10) / 10,
      Math.round(r.width * 10) / 10,
      Math.round(r.height * 10) / 10,
    ]),
  ];

  try {
    const json = JSON.stringify(compact);

    // Convert to URL-safe base64
    // Replace + with -, / with _, and remove = padding
    const base64 = btoa(json)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    return base64;
  } catch (error) {
    console.error('Failed to encode highlight:', error);
    return '';
  }
}

/**
 * Decode highlight data from URL-safe base64 string
 *
 * @param encoded - URL-safe base64 encoded string
 * @returns Decoded highlight data or null if invalid
 */
export function decodeHighlight(encoded: string): HighlightData | null {
  try {
    // Convert from URL-safe base64 back to standard base64
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');

    // Decode base64 to JSON string
    const json = atob(base64);

    // Parse JSON array
    const array = JSON.parse(json) as number[];

    if (!Array.isArray(array) || array.length < 5) {
      console.error('Invalid highlight data: array too short');
      return null;
    }

    // First element is page number
    const pageNumber = array[0];

    // Remaining elements are rectangle coordinates (groups of 4)
    const rects: HighlightRect[] = [];

    for (let i = 1; i < array.length; i += 4) {
      if (i + 3 < array.length) {
        rects.push({
          x: array[i],
          y: array[i + 1],
          width: array[i + 2],
          height: array[i + 3],
        });
      }
    }

    if (rects.length === 0) {
      console.error('Invalid highlight data: no rectangles found');
      return null;
    }

    return { pageNumber, rects };
  } catch (error) {
    console.error('Failed to decode highlight:', error);
    return null;
  }
}

/**
 * Generate shareable URL with highlight data
 *
 * @param baseUrl - Base URL (e.g., /filings/123)
 * @param pageNumber - PDF page number
 * @param rects - Highlight rectangles
 * @returns Full URL with encoded highlight parameter
 */
export function generateHighlightUrl(
  baseUrl: string,
  pageNumber: number,
  rects: HighlightRect[]
): string {
  const encoded = encodeHighlight(pageNumber, rects);

  if (!encoded) {
    console.error('Failed to generate highlight URL');
    return baseUrl;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}h=${encoded}`;
}
