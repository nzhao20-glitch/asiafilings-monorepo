export interface Filing {
  id: string;
  dartId: string;
  reportName: string;
  companyName: string;
  stockCode: string;
  reportDate: string;
  receiptDate: string;
  reporterName: string;
  dartUrl: string;

  // Processing status
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  processedAt?: string;
  errorMessage?: string;

  // Metadata
  pageCount?: number;
  fileSize?: number;
  documentSections?: number;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface FilingListParams {
  page?: number;
  limit?: number;
  search?: string;
  companyId?: string;
  filingType?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  processingStatus?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilingListResponse {
  success: boolean;
  data: {
    filings: Filing[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

export interface ProcessingStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  recentlyCompleted: number; // Last 24 hours
  avgProcessingTime: number; // In minutes
}

export interface SyncJob {
  id: string;
  type: 'company-sync' | 'filing-sync' | 'document-process';
  status: 'pending' | 'active' | 'completed' | 'failed';
  data: any;
  progress: number;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}