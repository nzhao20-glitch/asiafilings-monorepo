'use client';

import { useRouter } from 'next/navigation';

interface CompanyHeaderProps {
  company: {
    id: string;
    companyName: string;
    companyNameEn?: string;
    stockCode: string;
    marketType: string;
    industry?: string;
  };
}

export function CompanyHeader({ company }: CompanyHeaderProps) {
  const router = useRouter();

  if (!company || !company.companyName) {
    return null;
  }

  return (
    <div className="bg-white shadow-soft border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Back Navigation */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/filings')}
            className="inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Filing Search
          </button>
        </div>

        {/* Company Info */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0">
                <div className="w-16 h-16 bg-gradient-to-br from-primary-600 to-primary-700 rounded-xl flex items-center justify-center shadow-soft">
                  <span className="text-white font-bold text-xl">{company.companyName.charAt(0)}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold text-neutral-900 truncate mb-2">
                  {company.companyName}
                </h1>
                {company.companyNameEn && (
                  <p className="text-lg text-neutral-600">
                    {company.companyNameEn}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="flex items-center px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg">
                <span className="text-xs font-medium text-primary-700 mr-1">Stock Code</span>
                <span className="text-sm font-mono font-semibold text-primary-900">{company.stockCode}</span>
              </div>

              <div className="flex items-center px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg">
                <span className="text-xs font-medium text-secondary-700 mr-1">Market</span>
                <span className="text-sm font-semibold text-secondary-900">{company.marketType}</span>
              </div>

              {company.industry && (
                <div className="flex items-center px-3 py-2 bg-accent-50 border border-accent-200 rounded-lg">
                  <span className="text-xs font-medium text-accent-700 mr-1">Industry</span>
                  <span className="text-sm font-semibold text-accent-900">{company.industry}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0">
            <div className="flex flex-col sm:flex-row gap-3">
              <button className="btn-outline inline-flex items-center justify-center">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                Favorite
              </button>
              <button className="btn-primary inline-flex items-center justify-center">
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                Filing Alerts
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}