export interface MatchedPage {
  page_number: number;
  snippet: string;
  match_count: number;
}

export interface FilingSearchResult {
  document_id: string;
  total_pages: number;
  s3_key: string;
  exchange: string;
  company_id: string;
  company_name?: string;
  filing_date: string;
  filing_type?: string;
  title?: string;
  matched_pages: MatchedPage[];
}

export interface PageMatch {
  pageNumber: number;
  snippet: string;
  matchCount: number;
}
