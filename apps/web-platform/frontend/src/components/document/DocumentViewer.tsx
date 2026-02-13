/**
 * DocumentViewer - Simplified Document Viewer
 *
 * Clean PDF viewer with extracted tables display for Korean SEC filings
 * Features:
 * - PDF document display
 * - Extracted tables viewer
 * - Simple navigation
 * - Korean text support
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { DocumentIcon, InformationCircleIcon, ArrowLeftIcon, Bars3BottomLeftIcon } from '@heroicons/react/24/outline';
import { DocumentTOC } from './DocumentTOC';
import type { Filing } from '@asiafilings/shared';

// Dynamically import PDFViewerClient to avoid SSR issues
const PDFViewerClient = dynamic(
  () => import('./PDFViewerClient').then((mod) => mod.PDFViewerClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary-200 border-t-primary-600 mx-auto mb-4"></div>
          <p className="text-neutral-600 font-medium">Loading PDF viewer...</p>
        </div>
      </div>
    ),
  }
);

interface DocumentViewerProps {
  filing: Filing;
  stockCode?: string;
}

type TabType = 'document' | 'info';

// Helper function to decode HTML entities
function decodeHtmlEntities(text: string): string {
  if (typeof window === 'undefined') return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

export function DocumentViewer({ filing, stockCode }: DocumentViewerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('document');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [outline, setOutline] = useState<any[]>([]);
  const [showTOC, setShowTOC] = useState(false);
  const pdfNavigateRef = useRef<((dest: any) => void) | null>(null);

  // Get initial page from URL parameter
  const initialPage = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined;

  // Check for search query in URL parameters on mount
  // Uses negative trigger to compute highlights without showing the results modal
  useEffect(() => {
    const urlSearchQuery = searchParams.get('q');
    if (urlSearchQuery && urlSearchQuery.length >= 2) {
      setSearchQuery(urlSearchQuery);
      setDebouncedSearchQuery(urlSearchQuery);
      // Negative trigger = highlight only (no search results modal)
      setTimeout(() => {
        setSearchTrigger(-1);
      }, 500);
    }
  }, [searchParams]);

  // Debounce search query to avoid excessive re-renders
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle Enter key press to trigger search modal
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
      e.preventDefault();
      setSearchTrigger(prev => Math.abs(prev) + 1);
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  // Handle outline load from PDF
  const handleOutlineLoad = (loadedOutline: any[]) => {
    setOutline(loadedOutline || []);
  };

  // Handle TOC navigation
  const handleTOCNavigate = (dest: any) => {
    if (pdfNavigateRef.current) {
      pdfNavigateRef.current(dest);
    }
  };

  return (
    <div className="h-full flex bg-white">
      {/* Vertical Sidebar Menu */}
      <div className="w-[20vw] min-w-[250px] max-w-[350px] bg-gray-50 border-r border-gray-200 overflow-y-auto flex flex-col">
        {/* Navigation & Metadata Section */}
        <div className="p-6 border-b border-gray-200 bg-white">
          {/* Back to Company Link */}
          {stockCode && filing.company?.companyName && (
            <button
              onClick={() => router.push(`/companies/${filing.exchange || 'DART'}/${stockCode}`)}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-4 transition-colors group"
            >
              <ArrowLeftIcon className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              <span className="korean-text font-medium">{filing.company.companyName}</span>
            </button>
          )}

          {/* Filing Title */}
          <h1 className="text-lg font-semibold text-gray-900 korean-text mb-3">
            {filing.title}
          </h1>

          {/* Metadata */}
          <div className="space-y-2 text-sm">
            <div className="flex text-gray-600">
              <span className="font-medium text-gray-700 w-20 flex-shrink-0">Type:</span>
              <span>{decodeHtmlEntities(filing.filingType || '')}</span>
            </div>
            <div className="flex text-gray-600">
              <span className="font-medium text-gray-700 w-20 flex-shrink-0">Date:</span>
              <span>{filing.reportDate.toLocaleDateString('en-US')}</span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <input
              type="text"
              placeholder="Search document... (Press Enter to view results)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              className="w-full px-4 py-2.5 pr-10 border-2 border-gray-300 rounded-lg text-sm font-medium text-gray-900 bg-white placeholder:text-gray-500 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            <button
              type="button"
              onClick={() => {
                if (searchQuery.trim().length >= 2) {
                  setSearchTrigger(prev => Math.abs(prev) + 1);
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer"
              title="View search results"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
          {searchQuery && (
            <div className="mt-2 text-xs text-gray-500">
              Searching for "{searchQuery}"...
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="p-4 space-y-2 flex-1" aria-label="Sidebar">
          {/* TOC Toggle Button - Only show when document tab is active and outline exists */}
          {activeTab === 'document' && outline.length > 0 && (
            <button
              onClick={() => setShowTOC(!showTOC)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-sm transition-colors
                ${showTOC
                  ? 'bg-green-100 text-green-700'
                  : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <Bars3BottomLeftIcon className="h-5 w-5" />
              <span className="flex-1 text-left">Table of Contents</span>
              {outline.length > 0 && (
                <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">
                  {outline.length}
                </span>
              )}
            </button>
          )}

          <button
            onClick={() => handleTabChange('document')}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-sm transition-colors
              ${activeTab === 'document'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
              }
            `}
          >
            <DocumentIcon className="h-5 w-5" />
            Document
          </button>

          <button
            onClick={() => handleTabChange('info')}
            className={`
              w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-sm transition-colors
              ${activeTab === 'info'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
              }
            `}
          >
            <InformationCircleIcon className="h-5 w-5" />
            Info
          </button>
        </nav>
      </div>

      {/* Table of Contents Sidebar */}
      {activeTab === 'document' && showTOC && outline.length > 0 && (
        <div className="w-[18vw] min-w-[200px] max-w-[300px] h-full">
          <DocumentTOC
            outline={outline}
            onNavigate={handleTOCNavigate}
          />
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 bg-white overflow-hidden">
        {activeTab === 'document' && (
          <DocumentContent
            filing={filing}
            searchQuery={debouncedSearchQuery}
            searchTrigger={searchTrigger}
            onOutlineLoad={handleOutlineLoad}
            pdfNavigateRef={pdfNavigateRef}
            initialPage={initialPage}
          />
        )}

        {activeTab === 'info' && (
          <div className="h-full overflow-auto">
            <div className="p-6">
              <DocumentInfo filing={filing} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to detect file type from S3 key or URL
function getFileType(s3Key: string | null | undefined, sourceUrl: string | null | undefined): 'pdf' | 'htm' | 'doc' | 'unknown' {
  const key = s3Key || sourceUrl || '';
  const lowerKey = key.toLowerCase();

  if (lowerKey.endsWith('.pdf')) return 'pdf';
  if (lowerKey.endsWith('.htm') || lowerKey.endsWith('.html')) return 'htm';
  if (lowerKey.endsWith('.doc') || lowerKey.endsWith('.docx')) return 'doc';

  // Default to PDF if no extension (legacy behavior)
  if (s3Key && !lowerKey.includes('.')) return 'pdf';

  return 'unknown';
}

// Document Content Component - Multi-format viewer
function DocumentContent({
  filing,
  searchQuery,
  searchTrigger,
  onOutlineLoad,
  pdfNavigateRef,
  initialPage,
}: {
  filing: Filing;
  searchQuery: string;
  searchTrigger: number;
  onOutlineLoad: (outline: any[]) => void;
  pdfNavigateRef: React.MutableRefObject<((dest: any) => void) | null>;
  initialPage?: number;
}) {
  // Show loading spinner for dummy/initial loading state
  if (filing.id === 'dummy') {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary-200 border-t-primary-600 mx-auto mb-4"></div>
          <p className="text-neutral-600 font-medium">Loading document...</p>
        </div>
      </div>
    );
  }

  // If no file available after loading, show message
  if (!filing.pdfS3Key && !filing.sourceUrl) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center py-12">
          <DocumentIcon className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Document not available</h3>
          <p className="text-gray-500 mb-4">The document file has not been processed yet.</p>
        </div>
      </div>
    );
  }

  const fileType = getFileType(filing.pdfS3Key, filing.sourceUrl);
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  // PDF Viewer
  if (fileType === 'pdf') {
    const pdfUrl = `${API_URL}/api/files/${filing.pdfS3Key}`;
    const filingId = filing.id || (filing.exchange && filing.sourceId ? `${filing.exchange}:${filing.sourceId}` : undefined);

    return (
      <div className="h-full w-full bg-white">
        <PDFViewerClient
          fileUrl={pdfUrl}
          filingId={filingId}
          searchQuery={searchQuery}
          searchTrigger={searchTrigger}
          onOutlineLoad={onOutlineLoad}
          navigationRef={pdfNavigateRef}
          initialPage={initialPage}
        />
      </div>
    );
  }

  // HTML Viewer
  if (fileType === 'htm') {
    return (
      <HTMLViewer
        s3Key={filing.pdfS3Key}
        sourceUrl={filing.sourceUrl}
      />
    );
  }

  // DOC Viewer
  if (fileType === 'doc') {
    return (
      <DOCViewer
        s3Key={filing.pdfS3Key}
        sourceUrl={filing.sourceUrl}
      />
    );
  }

  // Unknown file type - show download link
  const downloadUrl = filing.pdfS3Key ? `${API_URL}/api/files/${filing.pdfS3Key}` : filing.sourceUrl;
  const fileName = filing.pdfS3Key?.split('/').pop() || 'document';
  const fileExt = fileName.split('.').pop()?.toUpperCase() || 'FILE';

  return (
    <div className="h-full w-full bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="w-24 h-24 mx-auto mb-6 bg-gray-400 rounded-2xl flex items-center justify-center shadow-lg">
          <DocumentIcon className="w-12 h-12 text-white" />
        </div>

        <h3 className="text-xl font-semibold text-gray-900 mb-2">{fileExt} Document</h3>
        <p className="text-gray-500 mb-6">
          This document format cannot be previewed in the browser.
        </p>

        <div className="space-y-3">
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={fileName}
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download Document</span>
            </a>
          )}

          {filing.sourceUrl && filing.sourceUrl !== downloadUrl && (
            <a
              href={filing.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>View Original Source</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// HTML Viewer Component - renders HTML documents
function HTMLViewer({ s3Key, sourceUrl }: { s3Key?: string | null; sourceUrl?: string | null }) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    const fetchHTML = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Try fetching from S3 first
        if (s3Key) {
          const response = await fetch(`${API_URL}/api/files/${s3Key}`);
          if (response.ok) {
            const text = await response.text();
            setHtmlContent(text);
            setIsLoading(false);
            return;
          }
        }

        // Fall back to source URL (may have CORS issues)
        if (sourceUrl) {
          // Use source URL in iframe instead
          setHtmlContent(null);
          setIsLoading(false);
          return;
        }

        setError('Could not load HTML document');
      } catch (err) {
        console.error('Failed to fetch HTML:', err);
        setError('Failed to load document');
      } finally {
        setIsLoading(false);
      }
    };

    fetchHTML();
  }, [s3Key, sourceUrl, API_URL]);

  if (isLoading) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary-200 border-t-primary-600 mx-auto mb-4"></div>
          <p className="text-neutral-600 font-medium">Loading HTML document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center py-12">
          <DocumentIcon className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error loading document</h3>
          <p className="text-gray-500 mb-4">{error}</p>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <span>View Original Document</span>
            </a>
          )}
        </div>
      </div>
    );
  }

  // Render fetched HTML content in a sandboxed iframe
  if (htmlContent) {
    return (
      <div className="h-full w-full bg-gray-100 overflow-auto">
        <div className="max-w-4xl mx-auto my-4 bg-white shadow-lg rounded-lg overflow-hidden">
          <iframe
            srcDoc={htmlContent}
            className="w-full border-0"
            style={{ minHeight: '100vh' }}
            sandbox="allow-same-origin"
            title="HTML Document"
          />
        </div>
      </div>
    );
  }

  // Use source URL directly in iframe (for external documents)
  if (sourceUrl) {
    return (
      <div className="h-full w-full bg-gray-100">
        <iframe
          src={sourceUrl}
          className="w-full h-full border-0"
          sandbox="allow-same-origin allow-scripts"
          title="HTML Document"
        />
      </div>
    );
  }

  return null;
}

// DOC Viewer Component - download-only for Word documents
function DOCViewer({ s3Key, sourceUrl }: { s3Key?: string | null; sourceUrl?: string | null }) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  // Prefer S3 URL through our API, fall back to source URL
  const downloadUrl = s3Key ? `${API_URL}/api/files/${s3Key}` : sourceUrl;
  const fileName = s3Key?.split('/').pop() || 'document.doc';

  if (!downloadUrl) {
    return (
      <div className="h-full w-full bg-white flex items-center justify-center">
        <div className="text-center py-12">
          <DocumentIcon className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Document not available</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md mx-auto p-8">
        {/* Word icon */}
        <div className="w-24 h-24 mx-auto mb-6 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9.5 17.5l-1.38-4.44h-.03L6.72 17.5H5.5l2.09-6h1.27l1.36 4.32h.02L11.6 11.5h1.27l2.09 6h-1.22l-1.37-4.44h-.02l-1.38 4.44H9.5zM14 9V3.5L18.5 9H14z"/>
          </svg>
        </div>

        <h3 className="text-xl font-semibold text-gray-900 mb-2">Word Document</h3>
        <p className="text-gray-500 mb-6">
          This is a Microsoft Word document (.doc) that cannot be previewed in the browser.
        </p>

        <div className="space-y-3">
          <a
            href={downloadUrl}
            download={fileName}
            className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Download Document</span>
          </a>

          {sourceUrl && sourceUrl !== downloadUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>View Original Source</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Document Info Component
function DocumentInfo({ filing }: { filing: Filing }) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white shadow overflow-hidden rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Document Information
          </h3>
        </div>
        <div className="border-t border-gray-200">
          <dl>
            <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-gray-500">Title</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 korean-text">
                {filing.title}
              </dd>
            </div>
            <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-gray-500">Company</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2 korean-text">
                {filing.company?.companyName || '-'}
              </dd>
            </div>
            <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-gray-500">Filing Type</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                {filing.filingType}
              </dd>
            </div>
            <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
              <dt className="text-sm font-medium text-gray-500">Report Date</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                {filing.reportDate.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </dd>
            </div>
            {filing.ingestedAt && (
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Ingested At</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {filing.ingestedAt.toLocaleString('en-US')}
                </dd>
              </div>
            )}
            {filing.sourceUrl && (
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Source Link</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  <a
                    href={filing.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    View Original Document →
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

export default DocumentViewer;
