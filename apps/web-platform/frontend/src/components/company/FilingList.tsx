'use client';

import { useRouter } from 'next/navigation';
import { FilingCategory } from './FilingCategoryTabs';

interface Filing {
  id: string;
  title: string;
  filingType: string;
  reportDate: string;
  submissionDate: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  size?: number;
  pages?: number;
  dartUrl?: string;
}

interface FilingListProps {
  filings: Filing[];
  category: FilingCategory;
  isLoading?: boolean;
  companyId: string;
}

const getStatusBadge = (status: Filing['processingStatus']) => {
  const statusConfig = {
    pending: { text: 'Pending', class: 'bg-yellow-100 text-yellow-800' },
    processing: { text: 'Processing', class: 'bg-blue-100 text-blue-800' },
    completed: { text: 'Completed', class: 'bg-green-100 text-green-800' },
    failed: { text: 'Failed', class: 'bg-red-100 text-red-800' },
  };

  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.class}`}>
      {config.text}
    </span>
  );
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '';

  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export function FilingList({ filings, category, isLoading, companyId }: FilingListProps) {
  const router = useRouter();

  const handleFilingClick = (filing: Filing) => {
    if (filing.processingStatus === 'completed' && filing.dartUrl) {
      // Extract rcpNo from dartUrl
      const match = filing.dartUrl.match(/rcpNo=(\d+)/);
      if (match) {
        const rcpNo = match[1];
        router.push(`/filings/${rcpNo}`);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-200 rounded-lg h-24"></div>
        ))}
      </div>
    );
  }

  if (filings.length === 0) {
    return (
      <div className="text-center py-12">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8c0 2.152-.848 4.103-2.229 5.291z" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No Filings Found</h3>
        <p className="mt-1 text-sm text-gray-500">
          There are no filings in this category yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filings.map((filing) => (
        <div
          key={filing.id}
          className={`bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow ${
            filing.processingStatus === 'completed' ? 'cursor-pointer hover:border-blue-300' : 'cursor-default'
          }`}
          onClick={() => handleFilingClick(filing)}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              {/* Filing Title */}
              <h3 className={`text-lg font-medium truncate ${
                filing.processingStatus === 'completed' ? 'text-blue-600 hover:text-blue-800' : 'text-gray-900'
              }`}>
                {filing.title}
              </h3>

              {/* Filing Type */}
              <div className="mt-1 flex items-center space-x-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {filing.filingType}
                </span>
                {getStatusBadge(filing.processingStatus)}
              </div>

              {/* Dates and Meta */}
              <div className="mt-2 flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-4 text-sm text-gray-500">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Report Date: {formatDate(filing.reportDate)}</span>
                </div>

                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Submitted: {formatDate(filing.submissionDate)}</span>
                </div>

                {filing.size && (
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8c0 2.152-.848 4.103-2.229 5.291z" />
                    </svg>
                    <span>{formatFileSize(filing.size)}</span>
                  </div>
                )}

                {filing.pages && (
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span>{filing.pages} pages</span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Arrow */}
            {filing.processingStatus === 'completed' && (
              <div className="ml-4 flex-shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}