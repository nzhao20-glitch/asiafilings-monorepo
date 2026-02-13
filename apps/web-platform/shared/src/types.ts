// ============================================================================
// Core Types (Aligned with HKEXScraper internal/models/database.go)
// ============================================================================

/**
 * Exchange identifier
 * Matches HKEXScraper Exchange type
 */
export type Exchange = 'DART' | 'HKEX';

/**
 * Market type enum
 * Includes both Korea and Hong Kong markets
 */
export type MarketType = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'SEHK' | 'GEM' | 'OTHER';

/**
 * Language enum
 * Matches HKEXScraper Language type
 */
export type Language = 'KO' | 'EN' | 'ZH' | 'MIXED';

/**
 * Processing status enum
 * Matches HKEXScraper ProcessingStatus type
 */
export type ProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'URL_FAILURE' | 'RATE_LIMITED';

/**
 * Exchange configuration for UI
 */
export const EXCHANGE_CONFIG = {
  DART: {
    name: 'Korea',
    displayName: '한국',
    flag: '🇰🇷',
    language: 'ko',
    searchPlaceholder: 'Search Korean companies and filings...',
    heroTitle: '한국 증권선물위원회 공시 검색',
    heroSubtitle: '상장기업의 공시문서를 빠르게 찾아보세요',
    markets: ['KOSPI', 'KOSDAQ', 'KONEX'] as const,
  },
  HKEX: {
    name: 'Hong Kong',
    displayName: '香港',
    flag: '🇭🇰',
    language: 'zh',
    searchPlaceholder: 'Search Hong Kong companies and filings...',
    heroTitle: 'Hong Kong Stock Exchange Filings',
    heroSubtitle: 'Browse filings from HKEX listed companies',
    markets: ['SEHK', 'GEM'] as const,
  },
} as const;

export type ExchangeConfig = typeof EXCHANGE_CONFIG[Exchange];

// ============================================================================
// Entity Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  organization: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Company entity
 * Aligned with HKEXScraper Company struct
 */
export interface Company {
  id: string;
  stockCode: string;
  companyName: string;
  companyNameEn?: string;
  marketType: MarketType;
  industry?: string;
  exchange: Exchange;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filing entity
 * Aligned with HKEXScraper Filing struct
 */
export interface Filing {
  id: string;
  companyId: string;
  company?: Company;
  sourceId?: string;      // HKEX NewsID or DART rcpNo
  exchange: Exchange;
  filingType: string;
  filingSubType?: string; // HKEX T2Code
  reportDate: Date;
  title: string;
  titleEn?: string;
  sourceUrl: string;      // Renamed from dartUrl
  pdfS3Key?: string;
  localPath?: string;
  pageCount?: number;
  fileSize?: number;
  fileExtension?: string; // pdf, htm
  language: Language;
  processingStatus: ProcessingStatus;
  processingError?: string;
  ingestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilingMetadata {
  id: string;
  filingId: string;
  filing?: Filing;
  extractedText?: string;
  tables?: ExtractedTable[];
  processingStatus: ProcessingStatus;
  processingError?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Extracted table entity
 * Aligned with HKEXScraper ExtractedTable struct
 */
export interface ExtractedTable {
  id: string;
  filingId: string;
  pageNumber: number;
  tableIndex: number;
  headers: string[][];
  rows: string[][];
  position: BoundingBox;
  confidence?: number;
  createdAt: Date;
}

/**
 * Bounding box for positioning
 * Aligned with HKEXScraper BoundingBox struct
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchResult {
  filingId: string;
  filing: Filing;
  matches: SearchMatch[];
  relevanceScore: number;
}

export interface SearchMatch {
  pageNumber: number;
  snippet: string;
  highlightedSnippet: string;
  position?: BoundingBox;
}

// ============================================================================
// API Response Types (Shared between Frontend and Backend)
// ============================================================================

/**
 * Standard API response wrapper
 * All API endpoints return this structure
 */
export interface APIResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Pagination metadata
 * Used in paginated responses
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Generic paginated response structure
 * Used for list endpoints (companies, filings, etc.)
 */
export interface PaginatedData<T> {
  [key: string]: T[] | PaginationMeta;
  pagination: PaginationMeta;
}

/**
 * Convenience type for paginated API responses
 */
export type PaginatedResponse<T> = APIResponse<PaginatedData<T>>;

/**
 * Helper type for extracting paginated data
 */
export interface CompaniesResponse {
  companies: Company[];
  pagination: PaginationMeta;
}

export interface FilingsResponse {
  filings: Filing[];
  pagination: PaginationMeta;
}

export interface SyncJobsResponse {
  jobs: SyncJob[];
  pagination: PaginationMeta;
}

/**
 * System health check response
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  database: {
    status: 'connected' | 'disconnected';
    latency?: number;
  };
  redis?: {
    status: 'connected' | 'disconnected';
    latency?: number;
  };
  storage?: {
    status: 'accessible' | 'inaccessible';
  };
}

/**
 * Sync job interface
 */
export interface SyncJob {
  id: string;
  type: 'company_sync' | 'filing_sync' | 'document_download';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
