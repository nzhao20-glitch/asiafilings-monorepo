import type { FilingSearchResult, PageMatch } from '@/src/types/quickwit';

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FilingResult {
  documentId: string;
  title: string;
  filingDate: string;
  filingType: string;
  s3Key: string;
  exchange: string;
  matches: PageMatch[];
  matchedPages: number[];
  matchedPageCount: number;
}

/**
 * Maps backend FilingSearchResult[] to camelCase FilingResult[].
 */
export function toFilingResults(results: FilingSearchResult[]): FilingResult[] {
  const mapped = results.map((r) => {
    const matches: PageMatch[] = r.matched_pages.map((mp) => ({
      pageNumber: mp.page_number,
      snippet: mp.snippet,
      matchCount: mp.match_count,
    }));

    return {
      documentId: r.document_id,
      title: r.title || r.document_id,
      filingDate: r.filing_date,
      filingType: r.filing_type || '',
      s3Key: r.s3_key,
      exchange: r.exchange,
      matches,
      matchedPages: matches.map((m) => m.pageNumber),
      matchedPageCount: matches.length,
    };
  });

  // Ensure UI consistently shows newest filings first.
  return mapped.sort((a, b) => {
    const aTime = Date.parse(a.filingDate);
    const bTime = Date.parse(b.filingDate);

    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;

    return bTime - aTime;
  });
}
