'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';
import { useExchange, EXCHANGE_CONFIG } from '@/src/contexts/ExchangeContext';
import KR from 'country-flag-icons/react/3x2/KR';
import HK from 'country-flag-icons/react/3x2/HK';

const FLAG_COMPONENTS: Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement>>> = { KR, HK };

interface Company {
  id: string;
  name: string;
  stockCode: string;
  marketType: string;
  exchange?: string;
}

// Stats by exchange
const EXCHANGE_STATS = {
  DART: {
    companies: '~2,200',
    companiesLabel: 'Listed Companies',
    filings: '~110,000',
    filingsLabel: 'Annual Filings',
    syncLabel: 'Data Sync',
  },
  HKEX: {
    companies: '~2,600',
    companiesLabel: 'Listed Companies',
    filings: '~180,000',
    filingsLabel: 'Annual Filings',
    syncLabel: 'Data Sync',
  },
} as const;

function FilingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('q') || '';
  const { exchange, config: exchangeConfig } = useExchange();

  // Search companies with exchange filter
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['company-search', searchQuery, exchange],
    queryFn: () => apiService.searchCompanies(searchQuery, exchange),
    enabled: searchQuery.length >= 1,
    staleTime: 5 * 60 * 1000,
  });

  const companies = searchResults?.data || [];
  const stats = EXCHANGE_STATS[exchange];

  const handleCompanyClick = (company: Company) => {
    router.push(`/companies/${exchange}/${company.stockCode}`);
  };

  const formatCompanyDisplay = (company: Company) => {
    return (
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold text-neutral-900">{company.name}</span>
          <span className="ml-2 text-sm text-primary-600 font-medium">({company.stockCode})</span>
        </div>
        <span className="text-xs font-semibold text-primary-700 bg-blue-50 px-3 py-1 rounded-lg shadow-soft border border-primary-200">
          {company.marketType}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-stone-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Header with gradient background */}
        <div className="text-center mb-12 bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 rounded-3xl p-12 shadow-strong">
          <div>
            <div className="inline-flex items-center gap-2 mb-4">
              {(() => { const F = FLAG_COMPONENTS[exchangeConfig.countryCode]; return F ? <F className="w-12 h-8 rounded" /> : null; })()}
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 drop-shadow-lg">
              {exchangeConfig.heroTitle}
            </h1>
            <p className="text-xl text-primary-50 mb-6">
              {exchangeConfig.heroSubtitle}
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-white text-sm font-medium shadow-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Use the search bar above to find companies by name or stock code
            </div>
          </div>
        </div>

        {/* Search Results */}
        {searchQuery.length >= 1 && (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-elevated p-6 border border-primary-200">
              <h2 className="text-lg font-bold text-primary-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search results for "{searchQuery}"
              </h2>

              {isLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-200 border-t-primary-600 mx-auto mb-4"></div>
                  <p className="text-neutral-600 font-medium">Searching...</p>
                </div>
              ) : companies.length > 0 ? (
                <div className="bg-blue-50 border border-primary-200 rounded-xl shadow-medium divide-y divide-primary-100">
                  {companies.map((company: Company) => (
                    <button
                      key={company.id}
                      onClick={() => handleCompanyClick(company)}
                      className="w-full px-4 py-4 text-left hover:bg-blue-100 focus:bg-blue-100 focus:outline-none transition-all duration-200"
                    >
                      {formatCompanyDisplay(company)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-blue-50 rounded-xl border border-primary-200 shadow-soft">
                  <svg className="mx-auto h-12 w-12 text-primary-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8c0 2.152-.848 4.103-2.229 5.291z" />
                  </svg>
                  <p className="text-neutral-700 font-semibold">
                    No results found for "{searchQuery}".
                  </p>
                  <p className="text-sm text-neutral-600 mt-1">
                    Try entering the company name or stock code more precisely.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stats Section */}
        <div className="bg-white rounded-2xl shadow-elevated border border-primary-200 p-10 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-center mb-8 bg-gradient-to-r from-primary-700 to-secondary-600 bg-clip-text text-transparent">
              Platform Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
              <div className="bg-blue-50 rounded-xl p-6 shadow-medium hover:shadow-elevated hover:-translate-y-1 transition-all duration-300">
                <div className="text-4xl font-bold text-primary-700 mb-2">{stats.companies}</div>
                <div className="text-neutral-700 font-semibold">{stats.companiesLabel}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-6 shadow-medium hover:shadow-elevated hover:-translate-y-1 transition-all duration-300">
                <div className="text-4xl font-bold text-primary-700 mb-2">{stats.filings}</div>
                <div className="text-neutral-700 font-semibold">{stats.filingsLabel}</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-6 shadow-medium hover:shadow-elevated hover:-translate-y-1 transition-all duration-300">
                <div className="text-4xl font-bold text-primary-700 mb-2">Real-time</div>
                <div className="text-neutral-700 font-semibold">{stats.syncLabel}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-blue-50 rounded-xl p-6 border border-primary-200 shadow-medium hover:shadow-elevated hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-lg font-bold text-primary-900">Coming Soon</h3>
            </div>
            <p className="text-sm text-neutral-700">
              Recent companies and favorites features coming soon
            </p>
          </div>

          <button
            onClick={() => router.push('/contact')}
            className="bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600 rounded-xl p-6 shadow-medium hover:shadow-strong hover:-translate-y-1 transition-all duration-300 text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h3 className="text-lg font-bold text-white">Contact Us</h3>
              </div>
              <svg className="w-5 h-5 text-white group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <p className="text-sm text-primary-50">
              Have questions or feedback? Get in touch with us
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FilingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <FilingsPageContent />
    </Suspense>
  );
}
