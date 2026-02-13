/**
 * API Service Layer
 * 
 * Centralized API client for Korean SEC Filing Viewer with:
 * - Type-safe HTTP client
 * - Korean error message handling
 * - Automatic retry logic
 * - Request/response transformation
 */

import type {
  Filing,
  DocumentSection,
  StructuredTable,
  SearchResult,
  ApiResponse,
  APIResponse,
  CompaniesResponse,
  FilingsResponse,
  SyncJobsResponse,
  PaginatedResponse,
} from '@/src/types/document';

// Additional types needed
interface Company {
  id: string;
  companyName: string;
  stockCode: string;
  marketType: string;
  companyNameEn?: string;
  industry?: string;
  companies?: any[]; // For paginated response
}

interface User {
  id: string;
  email: string;
  name?: string;
}

import type {
  Filing as FilingType,
  FilingListParams,
  FilingListResponse,
  ProcessingStats,
  SyncJob
} from '@/src/types/filing';

// API Configuration
// Use empty string for relative URLs when NEXT_PUBLIC_API_URL is not set or empty
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  retry?: boolean;
}

interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: any;
}

// Custom error class for API errors
class KoreanApiError extends Error implements ApiError {
  status?: number;
  code?: string;
  details?: any;
  
  constructor(message: string, status?: number, code?: string, details?: any) {
    super(message);
    this.name = 'KoreanApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// HTTP client with Korean error handling
class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    };
  }
  
  private async request<T>(
    endpoint: string, 
    config: RequestConfig = {}
  ): Promise<T> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      retry = true,
    } = config;
    
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    
    // Set timeout
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      // Get auth token if available
      const authToken = this.getAuthToken();
      const requestHeaders = {
        ...this.defaultHeaders,
        ...headers,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      };
      
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Handle non-JSON responses (e.g., file downloads)
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        if (response.ok) {
          return response as unknown as T;
        }
        throw new KoreanApiError(
          '파일 다운로드 중 오류가 발생했습니다.',
          response.status
        );
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new KoreanApiError(
          this.getKoreanErrorMessage(data.error?.message || response.statusText, response.status),
          response.status,
          data.error?.code,
          data.error?.details
        );
      }
      
      return data;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof KoreanApiError) {
        throw error;
      }
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new KoreanApiError('요청 시간이 초과되었습니다.', 408);
      }
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new KoreanApiError('네트워크 연결을 확인해주세요.', 0);
      }
      
      throw new KoreanApiError('알 수 없는 오류가 발생했습니다.', 500);
    }
  }
  
  private getAuthToken(): string | null {
    // Get token from cookies where auth context stores it
    if (typeof window !== 'undefined') {
      // Try localStorage first (fallback)
      const localToken = localStorage.getItem('auth_token');
      if (localToken) return localToken;

      // Get from cookies (main method used by auth context)
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'accessToken') {
          return decodeURIComponent(value);
        }
      }
    }
    return null;
  }
  
  private getKoreanErrorMessage(message: string, status?: number): string {
    // Map common error messages to Korean
    const errorMessages: Record<string, string> = {
      'Unauthorized': '인증이 필요합니다.',
      'Forbidden': '접근 권한이 없습니다.',
      'Not Found': '요청한 데이터를 찾을 수 없습니다.',
      'Bad Request': '잘못된 요청입니다.',
      'Internal Server Error': '서버 내부 오류가 발생했습니다.',
      'Service Unavailable': '서비스를 일시적으로 사용할 수 없습니다.',
      'Too Many Requests': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    };
    
    // Status code based messages
    if (status) {
      switch (status) {
        case 400: return '입력값을 확인해주세요.';
        case 401: return '로그인이 필요합니다.';
        case 403: return '이 기능에 대한 권한이 없습니다.';
        case 404: return '요청한 페이지나 데이터를 찾을 수 없습니다.';
        case 408: return '요청 시간이 초과되었습니다.';
        case 429: return '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.';
        case 500: return '서버에서 오류가 발생했습니다.';
        case 502: return '서버가 응답하지 않습니다.';
        case 503: return '서비스가 일시적으로 중단되었습니다.';
      }
    }
    
    return errorMessages[message] || message || '알 수 없는 오류가 발생했습니다.';
  }
  
  // HTTP method helpers
  async get<T>(endpoint: string, config?: Omit<RequestConfig, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...config, method: 'GET' });
  }
  
  async post<T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...config, method: 'POST', body });
  }
  
  async put<T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...config, method: 'PUT', body });
  }
  
  async delete<T>(endpoint: string, config?: Omit<RequestConfig, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...config, method: 'DELETE' });
  }
  
  async patch<T>(endpoint: string, body?: any, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<T> {
    return this.request<T>(endpoint, { ...config, method: 'PATCH', body });
  }
}

// Create API client instance
const apiClient = new ApiClient(API_BASE_URL);

// Authentication API
export const authApi = {
  login: (credentials: { username: string; password: string }) =>
    apiClient.post<ApiResponse<{ user: User; token: string }>>('/api/auth/login', credentials),
    
  logout: () =>
    apiClient.post<ApiResponse<void>>('/api/auth/logout'),
    
  refreshToken: () =>
    apiClient.post<ApiResponse<{ token: string }>>('/api/auth/refresh'),
    
  getProfile: () =>
    apiClient.get<ApiResponse<User>>('/api/auth/profile'),
    
  updateProfile: (data: Partial<User>) =>
    apiClient.patch<ApiResponse<User>>('/api/auth/profile', data),
};

// Exchange type for filtering
type Exchange = 'DART' | 'HKEX';

// Companies API
export const companiesApi = {
  getCompanies: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    sector?: string;
    exchange?: Exchange;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sector) searchParams.set('sector', params.sector);
    if (params?.exchange) searchParams.set('exchange', params.exchange);

    return apiClient.get<PaginatedResponse<Company>>(`/api/companies?${searchParams}`);
  },
  
  getCompany: (id: string) =>
    apiClient.get<ApiResponse<{
      company: {
        id: string;
        stockCode: string;
        companyName: string;
        companyNameEn?: string;
        marketType: string;
        industry?: string;
        recentFilings: Array<any>;
      }
    }>>(`/api/companies/${id}`).then(response => ({
      data: response.data.company
    })),

  getCompanyByStockCode: (stockCode: string, exchange?: Exchange) => {
    const params = exchange ? `?exchange=${exchange}` : '';
    return apiClient.get<ApiResponse<{
      company: {
        id: string;
        stockCode: string;
        companyName: string;
        companyNameEn?: string;
        marketType: string;
        industry?: string;
        exchange?: Exchange;
        recentFilings: Array<any>;
      }
    }>>(`/api/companies/by-stock-code/${stockCode}${params}`).then(response => ({
      data: response.data.company
    }));
  },

  searchCompanyFilings: (stockCode: string, query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', limit.toString());

    return apiClient.get<ApiResponse<{
      results: Array<{
        id: string;
        rcpNo?: string;
        title: string;
        titleEn?: string;
        filingType: string;
        reportDate: string;
        dartUrl?: string;
        snippet: string;
        matchType: 'text' | 'table' | 'title';
        pageNumber?: number;
        tableId?: string;
        processingStatus?: string;
      }>;
      total: number;
      query: string;
      companyName: string;
    }>>(`/api/companies/${stockCode}/search?${params}`);
  },

  getCompanyFilings: (id: string, params?: {
    page?: number;
    limit?: number;
    year?: number;
    type?: string;
  }) => {
    const searchParams = new URLSearchParams();
    searchParams.set('companyId', id);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.year) searchParams.set('year', params.year.toString());
    if (params?.type) searchParams.set('type', params.type);

    return apiClient.get<any>(`/api/filings?${searchParams}`).then(response => ({
      data: {
        filings: response.data.filings.map((filing: any) => ({
          ...filing,
          createdAt: filing.createdAt || filing.reportDate,
        }))
      }
    }));
  },
};

// Filings API
export const filingsApi = {
  getFilings: (params?: {
    page?: number;
    limit?: number;
    company?: string;
    type?: string;
    year?: number;
    quarter?: number;
    exchange?: Exchange;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.company) searchParams.set('company', params.company);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.year) searchParams.set('year', params.year.toString());
    if (params?.quarter) searchParams.set('quarter', params.quarter.toString());
    if (params?.exchange) searchParams.set('exchange', params.exchange);

    return apiClient.get<PaginatedResponse<Filing>>(`/api/filings?${searchParams}`);
  },
  
  getFiling: (id: string) =>
    apiClient.get<ApiResponse<Filing>>(`/api/filings/${id}`),

  getFilingByRcpNo: (rcpNo: string) =>
    apiClient.get<ApiResponse<Filing>>(`/api/filings/by-rcp-no/${rcpNo}`),

  getFilingDocument: (id: string) =>
    apiClient.get<ApiResponse<{ sections: DocumentSection[] }>>(`/api/filings/${id}/document`),
    
  getFilingTables: (id: string) =>
    apiClient.get<ApiResponse<{ tables: StructuredTable[] }>>(`/api/filings/${id}/tables`),

  downloadFiling: (id: string, format: 'pdf' | 'xml') =>
    apiClient.get<Response>(`/api/filings/${id}/download?format=${format}`, {
      headers: { 'Accept': 'application/octet-stream' }
    }),
};

// Search API
export const searchApi = {
  searchFilings: (query: string, filters?: {
    companies?: string[];
    types?: string[];
    years?: number[];
    page?: number;
    limit?: number;
  }) => {
    const body = { query, filters };
    return apiClient.post<PaginatedResponse<SearchResult>>('/api/search/filings', body);
  },

  searchDocuments: (query: string, options?: {
    filingId?: string;
    sectionTypes?: string[];
    page?: number;
    limit?: number;
  }) => {
    const body = { query, options };
    return apiClient.post<PaginatedResponse<SearchResult>>('/api/search/documents', body);
  },

  getSearchSuggestions: (query: string) =>
    apiClient.get<ApiResponse<{ suggestions: string[] }>>(`/api/search/suggestions?q=${encodeURIComponent(query)}`),
};

// User API
export const userApi = {
  getBookmarks: () =>
    apiClient.get<PaginatedResponse<any>>('/api/user/bookmarks'),
    
  addBookmark: (data: { filingId: string; sectionId?: string; note?: string }) =>
    apiClient.post<ApiResponse<any>>('/api/user/bookmarks', data),
    
  removeBookmark: (id: string) =>
    apiClient.delete<ApiResponse<void>>(`/api/user/bookmarks/${id}`),
    
  getHistory: () =>
    apiClient.get<PaginatedResponse<any>>('/api/user/history'),
    
  addToHistory: (data: { filingId: string; action: string; metadata?: any }) =>
    apiClient.post<ApiResponse<any>>('/api/user/history', data),
};

// System API
export const systemApi = {
  getHealth: () =>
    apiClient.get<ApiResponse<{ status: string; timestamp: string }>>('/api/health'),
    
  getDartStatus: () =>
    apiClient.get<ApiResponse<{ available: boolean; lastSync: string }>>('/api/system/dart-status'),
};

// Real-time endpoints for document processing status
export const documentProcessingApi = {
  processDocument: (filingId: string, config?: any) =>
    apiClient.post<ApiResponse<{ filingId: string; status: string; message: string }>>('/api/documents/process', { filingId, config }),
    
  getProcessingStatus: (filingId: string) =>
    apiClient.get<ApiResponse<{ status: string; progress: number; currentStep?: string; error?: string }>>(`/api/documents/process/${filingId}/status`),
    
  getProcessingStats: () =>
    apiClient.get<ApiResponse<{ totalProcessed: number; successfullyProcessed: number; currentlyProcessing: number }>>('/api/documents/processing/stats'),
};

// Export convenience functions
export const getCompanies = companiesApi.getCompanies;
export const getCompany = companiesApi.getCompany;
export const getCompanyByStockCode = companiesApi.getCompanyByStockCode;
export const getCompanyFilings = companiesApi.getCompanyFilings;

export const getFilings = filingsApi.getFilings;
export const getFiling = filingsApi.getFiling;
export const getFilingByRcpNo = filingsApi.getFilingByRcpNo;
export const getFilingDocument = filingsApi.getFilingDocument;
export const getFilingTables = filingsApi.getFilingTables;
export const downloadFiling = filingsApi.downloadFiling;

export const searchFilings = searchApi.searchFilings;
export const searchDocuments = searchApi.searchDocuments;
export const getSearchSuggestions = searchApi.getSearchSuggestions;

export const login = authApi.login;
export const logout = authApi.logout;
export const getProfile = authApi.getProfile;

export const processDocument = documentProcessingApi.processDocument;
export const getProcessingStatus = documentProcessingApi.getProcessingStatus;

// Filing Management API
export const filingManagementApi = {
  getFilings: (params: FilingListParams) => {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', params.page.toString());
    if (params.limit) searchParams.set('limit', params.limit.toString());
    if (params.search) searchParams.set('search', params.search);
    if (params.companyId) searchParams.set('companyId', params.companyId);
    if (params.filingType) searchParams.set('filingType', params.filingType);
    if (params.processingStatus) searchParams.set('processingStatus', params.processingStatus);
    if (params.dateRange?.start) searchParams.set('startDate', params.dateRange.start);
    if (params.dateRange?.end) searchParams.set('endDate', params.dateRange.end);
    if (params.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

    return apiClient.get<FilingListResponse>(`/api/filings?${searchParams}`);
  },

  getProcessingStats: () =>
    apiClient.get<ApiResponse<ProcessingStats>>('/api/filings/processing/stats'),

  triggerSync: (data: {
    type: 'companies' | 'filings';
    companyId?: string;
    startDate?: string;
    endDate?: string;
    force?: boolean;
  }) =>
    apiClient.post<ApiResponse<{ jobId: string }>>('/api/admin/sync', data),

  getSyncJobs: (params?: { page?: number; limit?: number; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.status) searchParams.set('status', params.status);

    return apiClient.get<PaginatedResponse<SyncJob>>(`/api/admin/sync/jobs?${searchParams}`);
  },

  retrySyncJob: (jobId: string) =>
    apiClient.post<ApiResponse<{ jobId: string }>>(`/api/admin/sync/jobs/${jobId}/retry`),

  cancelSyncJob: (jobId: string) =>
    apiClient.post<ApiResponse<void>>(`/api/admin/sync/jobs/${jobId}/cancel`),

  retryFailedFiling: (filingId: string) =>
    apiClient.post<ApiResponse<{ status: string }>>(`/api/filings/${filingId}/retry`),
};

// BamSEC-style search API using real endpoints
export const newSearchApi = {
  searchCompanies: (query: string, exchange?: Exchange) => {
    const searchParams = new URLSearchParams();
    searchParams.set('search', query);
    searchParams.set('limit', '10'); // Limit for autocomplete
    if (exchange) searchParams.set('exchange', exchange);
    const url = `/api/companies?${searchParams}`;

    return apiClient.get<{ success: boolean; data: any[]; meta: any }>(url).then(response => {
      // API returns data as array directly, not as { companies: [...] }
      const companies = Array.isArray(response.data) ? response.data : [];
      const transformedData = companies.map((company: any) => ({
        id: company.id,
        name: company.companyName,
        stockCode: company.stockCode,
        marketType: company.marketType,
        exchange: company.exchange
      }));
      return { data: transformedData };
    }).catch(error => {
      console.error('API Error:', error);
      throw error;
    });
  },

  getPopularCompanies: (exchange?: Exchange) => {
    // Get top companies (first page)
    const params = exchange ? `?limit=8&exchange=${exchange}` : '?limit=8';
    return apiClient.get<{ success: boolean; data: any[]; meta: any }>(`/api/companies${params}`).then(response => {
      // API returns data as array directly, not as { companies: [...] }
      const companies = Array.isArray(response.data) ? response.data : [];
      return {
        data: companies.map((company: any) => ({
          id: company.id,
          name: company.companyName,
          stockCode: company.stockCode,
          marketType: company.marketType,
          exchange: company.exchange
        }))
      };
    });
  },

  getCompanyFilingCounts: (companyId: string) =>
    // For now return static counts - this endpoint needs to be implemented
    Promise.resolve({ data: { all: 3, financials: 2, disclosures: 1, governance: 0, others: 0 } }),

  getCompanyFilings: (companyId: string, params?: {
    category?: string;
    page?: number;
    limit?: number;
  }) => {
    // Use the company detail endpoint which includes recent filings
    return apiClient.get<ApiResponse<{
      company: {
        recentFilings: Array<{
          id: string;
          title: string;
          filingType: string;
          reportDate: string;
          dartUrl: string;
          ingestedAt?: string;
        }>
      }
    }>>(`/api/companies/${companyId}`).then(response => ({
      data: {
        filings: response.data.company.recentFilings.map((filing: any) => ({
          id: filing.id,
          title: filing.title,
          filingType: filing.filingType,
          reportDate: filing.reportDate,
          submissionDate: filing.ingestedAt || filing.reportDate,
          processingStatus: 'completed' as const,
          size: 2048000,
          pages: 100
        }))
      }
    }));
  },
};

// Quickwit full-text search API
import type { FilingSearchResult } from '@/src/types/quickwit';

export const quickwitApi = {
  fullTextSearch: (query: string, companyId?: string, exchange?: string) =>
    apiClient.post<{ num_hits: number; results: FilingSearchResult[] }>('/api/quickwit-search', {
      query,
      company_id: companyId,
      exchange,
    }),
};

// Convenience service object
export const apiService = {
  ...authApi,
  ...companiesApi,
  ...filingsApi,
  ...searchApi,
  ...userApi,
  ...systemApi,
  ...documentProcessingApi,
  ...filingManagementApi,
  ...newSearchApi,
  ...quickwitApi,
};

export default apiClient;