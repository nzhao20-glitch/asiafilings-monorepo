/**
 * Document Types for Korean SEC Filing Viewer
 *
 * Simplified TypeScript interfaces for PDF + HTML documents with table extraction
 * No XBRL complexity - focus on clean document viewing and table display
 */

// Import shared types from @asiafilings/shared
import type {
  APIResponse,
  PaginationMeta,
  CompaniesResponse,
  FilingsResponse,
  SyncJobsResponse,
  SystemHealth,
  SyncJob,
  Company as SharedCompany,
  Filing as SharedFiling,
} from '@asiafilings/shared';

// Re-export shared types for easier imports (including Filing)
export type {
  APIResponse,
  PaginationMeta,
  CompaniesResponse,
  FilingsResponse,
  SyncJobsResponse,
  SystemHealth,
  SyncJob,
  Filing,
  Company
} from '@asiafilings/shared';

// Generic paginated response wrapper - convenience type for frontend use
export interface PaginatedResponse<T> {
  companies?: T[];
  filings?: T[];
  jobs?: T[];
  items?: T[];  // Generic fallback
  pagination: PaginationMeta;
}

// Extracted table from PDF/HTML
export interface ExtractedTable {
  id: string;
  filingId: string;
  caption?: string;
  pageNumber?: number;
  confidence?: number;
  source: 'pdf' | 'html';
  rows: TableRow[];
  metadata?: TableMetadata;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  value: string;
  type: 'HEADER' | 'TEXT' | 'NUMERIC' | 'EMPTY';
  alignment?: 'left' | 'center' | 'right';
  colspan?: number;
  rowspan?: number;
}

export interface TableMetadata {
  rowCount: number;
  columnCount: number;
  hasKoreanHeaders: boolean;
  extractedAt?: string;
  processingTimeMs?: number;
}

// Pagination request params
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Component prop interfaces
export interface DocumentViewerProps {
  filing: import('@asiafilings/shared').Filing;
  companyId?: string;
}

export interface ExtractedTablesProps {
  tables: ExtractedTable[];
  onTableClick?: (table: ExtractedTable) => void;
}

// Error handling
export interface DocumentError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  recoverable: boolean;
  retryAction?: () => Promise<void>;
}

// Document section for structured documents
export interface DocumentSection {
  sectionId: string;
  title: string;
  contentType: 'TEXT' | 'TABLE' | 'MIXED';
  contentData?: {
    text?: string;
    tables?: any[];
    images?: any[];
  };
  children?: DocumentSection[];
  level?: number;
  hasFinancialData?: boolean;
}

// Structured table interface for frontend display
export interface StructuredTable {
  id: string;
  caption?: string;
  columnCount?: number;
  rowCount?: number;
  hasFinancialData?: boolean;
  headers?: any[];
  rows?: any[];
  metadata?: {
    source?: string;
    pageNumber?: number;
    tableIndex?: number;
    confidence?: number;
    position?: any;
    lastUpdated?: string;
    notes?: string;
  };
}

// Search result interface
export interface SearchResult {
  sectionId: string;
  sectionTitle: string;
  matchText: string;
  filingId: string;
  relevanceScore?: number;
}

// Alias for compatibility
export type ApiResponse<T> = APIResponse<T>;
