'use client';

import { useRouter } from 'next/navigation';

export type FilingCategory = 'financials' | 'news' | 'ownership' | 'proxies' | 'prospectuses' | 'related_party' | 'other';

interface Filing {
  id: string;
  title: string;
  filingType: string;
  reportDate: string;
  createdAt: string;
  dartUrl?: string;
  category: FilingCategory;
  fileSize?: number;
  pageCount?: number;
  metadata?: {
    processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  };
}

interface FilingCategorySectionProps {
  category: FilingCategory;
  filings: Filing[];
  companyId: string;
}

export const categoryConfig: Record<FilingCategory, { name: string; icon: string; color: string }> = {
  financials: { name: 'Financial Information', icon: '📊', color: 'primary' },
  news: { name: 'News & Announcements', icon: '📰', color: 'secondary' },
  ownership: { name: 'Ownership Changes', icon: '👥', color: 'accent' },
  proxies: { name: 'Proxies', icon: '📋', color: 'primary' },
  prospectuses: { name: 'Prospectuses', icon: '📘', color: 'secondary' },
  related_party: { name: 'Related Party Transactions', icon: '🔗', color: 'accent' },
  other: { name: 'Other', icon: '📄', color: 'neutral' },
};

const getStatusBadge = (status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED') => {
  const statusConfig = {
    PENDING: { text: 'Pending', class: 'bg-accent-100 text-accent-800' },
    PROCESSING: { text: 'Processing', class: 'bg-primary-100 text-primary-800' },
    COMPLETED: { text: 'Completed', class: 'bg-secondary-100 text-secondary-800' },
    FAILED: { text: 'Failed', class: 'bg-red-100 text-red-800' },
  };

  if (!status) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-800">
        Unprocessed
      </span>
    );
  }

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

export function FilingCategorySection({ category, filings, companyId }: FilingCategorySectionProps) {
  const router = useRouter();
  const config = categoryConfig[category];

  const handleFilingClick = (filing: Filing) => {
    if (filing.metadata?.processingStatus === 'COMPLETED' && filing.dartUrl) {
      // Extract rcpNo from dartUrl
      const match = filing.dartUrl.match(/rcpNo=(\d+)/);
      if (match) {
        const rcpNo = match[1];
        router.push(`/filings/${rcpNo}`);
      }
    }
  };

  if (filings.length === 0) {
    return null;
  }

  const colorClasses = {
    primary: 'from-primary-50 to-primary-100 border-primary-200',
    secondary: 'from-secondary-50 to-secondary-100 border-secondary-200',
    accent: 'from-accent-50 to-accent-100 border-accent-200',
    neutral: 'from-neutral-50 to-neutral-100 border-neutral-200',
  };

  return (
    <div className="mb-8">
      {/* Category Header */}
      <div className={`card p-4 mb-4 bg-gradient-to-r ${colorClasses[config.color as keyof typeof colorClasses]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="text-3xl">{config.icon}</div>
            <div>
              <h2 className="text-xl font-semibold text-neutral-900">{config.name}</h2>
              <p className="text-sm text-neutral-600">{filings.length} filings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filings List */}
      <div className="space-y-3">
        {filings.map((filing) => {
          const isCompleted = filing.metadata?.processingStatus === 'COMPLETED';
          return (
            <div
              key={filing.id}
              className={`card p-5 hover:shadow-elevated transition-all ${
                isCompleted ? 'cursor-pointer' : 'cursor-default opacity-75'
              }`}
              onClick={() => handleFilingClick(filing)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  {/* Filing Title */}
                  <h3 className={`text-base font-semibold mb-2 ${
                    isCompleted ? 'text-primary-700 hover:text-primary-900' : 'text-neutral-900'
                  }`}>
                    {filing.title}
                  </h3>

                  {/* Filing Type & Status */}
                  <div className="flex items-center space-x-2 mb-3">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-800">
                      {filing.filingType}
                    </span>
                    {getStatusBadge(filing.metadata?.processingStatus)}
                  </div>

                  {/* Dates and Meta */}
                  <div className="flex flex-wrap gap-4 text-sm text-neutral-600">
                    <div className="flex items-center">
                      <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Report Date: {formatDate(filing.reportDate)}</span>
                    </div>

                    <div className="flex items-center">
                      <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Created: {formatDate(filing.createdAt)}</span>
                    </div>

                    {filing.fileSize && (
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span>{formatFileSize(filing.fileSize)}</span>
                      </div>
                    )}

                    {filing.pageCount && (
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8c0 2.152-.848 4.103-2.229 5.291z" />
                        </svg>
                        <span>{filing.pageCount} pages</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Arrow */}
                {isCompleted && (
                  <div className="ml-4 flex-shrink-0">
                    <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}