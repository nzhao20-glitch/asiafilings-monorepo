'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';
import { CompanyFilingSearch } from '@/src/components/company/CompanyFilingSearch';
import { decodeHtmlEntities, categorizeFilingType, categoryConfig, categoryOrder } from '@/src/utils/filing-categories';
import type { FilingCategory } from '@/src/utils/filing-categories';
import type { Exchange } from '@/src/contexts/ExchangeContext';

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const stockCode = params.stockCode as string;
  // Get exchange from URL params instead of context
  const exchange = (params.exchange as string)?.toUpperCase() as Exchange;
  const [categoryVisibleCounts, setCategoryVisibleCounts] = useState<Record<string, number>>({});

  const showMoreCategory = (category: string, totalFilings: number) => {
    setCategoryVisibleCounts(prev => {
      const currentVisible = prev[category] || 6;
      const newVisible = currentVisible + 10;
      return { ...prev, [category]: Math.min(newVisible, totalFilings) };
    });
  };

  const showLessCategory = (category: string) => {
    setCategoryVisibleCounts(prev => {
      const newCounts = { ...prev };
      delete newCounts[category];
      return newCounts;
    });
  };

  // Fetch company details by stock code with exchange filter
  const { data: companyData, isLoading: companyLoading } = useQuery({
    queryKey: ['company', stockCode, exchange],
    queryFn: () => apiService.getCompanyByStockCode(stockCode, exchange),
    enabled: !!stockCode && !!exchange,
  });

  const company = companyData?.data;
  const allFilings = company?.recentFilings || [];

  // Group filings by category, then sort chronologically
  const filingsByCategory = useMemo(() => {
    const grouped: Record<FilingCategory, any[]> = {
      financials: [],
      news: [],
      ownership: [],
      proxies: [],
      prospectuses: [],
      related_party: [],
      other: [],
    };

    allFilings.forEach((filing: any) => {
      const category = categorizeFilingType(filing.filingType, filing.title);
      grouped[category].push({ ...filing, category });
    });

    // Sort each category chronologically (most recent first)
    Object.keys(grouped).forEach((key) => {
      const category = key as FilingCategory;
      grouped[category].sort((a, b) =>
        new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
      );
    });

    return grouped;
  }, [allFilings]);


  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleFilingClick = (filing: any, hasMetadata: boolean) => {
    // Use rcpNo directly if available, otherwise try to extract from URL
    let rcpNo = filing.rcpNo;

    if (!rcpNo) {
      const sourceUrl = filing.sourceUrl || filing.dartUrl;
      if (sourceUrl) {
        const match = sourceUrl.match(/rcpNo=(\d+)/);
        if (match) {
          rcpNo = match[1];
        }
      }
    }

    if (hasMetadata && rcpNo) {
      router.push(`/filings/${rcpNo}`);
    }
  };

  if (companyLoading) {
    return (
      <div className="min-h-screen bg-stone-100">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-neutral-200 rounded w-64"></div>
            <div className="h-12 bg-neutral-200 rounded"></div>
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-neutral-100 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!company || !company.companyName) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-neutral-900">
            Company not found
          </h3>
          <p className="mt-2 text-sm text-neutral-600">
            The company you are looking for does not exist or has been removed.
          </p>
          <button
            onClick={() => router.push('/filings')}
            className="mt-4 text-primary-600 hover:text-primary-700 text-sm font-medium"
          >
            ← Back to search
          </button>
        </div>
      </div>
    );
  }

  const totalFilings = allFilings.length;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Company Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/filings')}
            className="text-sm text-neutral-600 hover:text-neutral-900 mb-4 inline-flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to search
          </button>

          <div className="mb-2">
            <h1 className="text-3xl font-bold text-neutral-900">{company.companyName}</h1>
            {company.companyNameEn && (
              <p className="text-lg text-neutral-600 mt-1">{company.companyNameEn}</p>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-neutral-600 mb-3">
            <span className="font-mono font-semibold">{company.stockCode}</span>
            <span>·</span>
            <span>{exchange}</span>
            {company.marketType && (
              <>
                <span>·</span>
                <span>{company.marketType}</span>
              </>
            )}
            {company.industry && (
              <>
                <span>·</span>
                <span>{company.industry}</span>
              </>
            )}
          </div>

          <p className="text-sm text-neutral-600">
            {totalFilings} filing{totalFilings !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Search Component */}
        <div className="mb-8">
          <CompanyFilingSearch
            stockCode={company.stockCode}
            companyName={company.companyName}
            companyId={company.stockCode}
            exchange={exchange}
          />
        </div>

        {/* Filings Grid by Category */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {(Object.keys(categoryConfig) as FilingCategory[]).map((category) => {
            const filings = filingsByCategory[category];
            const config = categoryConfig[category];
            const maxVisible = categoryVisibleCounts[category] || 6;
            const hasMore = filings.length > maxVisible;
            const isExpanded = maxVisible > 6;
            const visibleFilings = filings.slice(0, maxVisible);

            return (
              <div key={category} className="border border-primary-200 rounded-xl overflow-hidden bg-white shadow-elevated hover:shadow-strong hover:-translate-y-1 transition-all duration-300">
                {/* Category Header */}
                <div className="bg-blue-50 border-b border-primary-200 px-4 py-3">
                  <h2 className="text-sm font-bold text-primary-900 flex items-center gap-2">
                    <span className="text-base">{config.icon}</span>
                    <span>{config.name}</span>
                    <span className="text-xs font-semibold text-primary-600 bg-white px-2 py-0.5 rounded-full shadow-soft">({filings.length})</span>
                  </h2>
                </div>

                {/* Filings List or Empty State */}
                {filings.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-neutral-400">
                      No filings in this category
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-neutral-200">
                      {visibleFilings.map((filing: any) => {
                        const hasMetadata = filing.metadata?.processingStatus === 'COMPLETED';
                        return (
                          <div
                            key={filing.id}
                            onClick={() => handleFilingClick(filing, hasMetadata)}
                            className={`px-3 py-2.5 transition-all duration-200 ${
                              hasMetadata ? 'cursor-pointer hover:bg-blue-50' : 'cursor-default opacity-60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold truncate ${
                                  hasMetadata ? 'text-primary-700 hover:text-primary-800' : 'text-neutral-700'
                                }`}>
                                  {decodeHtmlEntities(filing.title)}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs font-medium text-neutral-600">
                                    {formatDate(filing.reportDate)}
                                  </span>
                                  <span className="text-xs text-neutral-400">·</span>
                                  <span className="text-xs text-neutral-600">
                                    {decodeHtmlEntities(filing.filingType)}
                                  </span>
                                </div>
                              </div>
                              {hasMetadata && (
                                <svg className="w-4 h-4 text-primary-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Expand/Collapse Buttons */}
                    {(hasMore || isExpanded) && (
                      <div className="border-t border-primary-200 flex items-center justify-center gap-3">
                        {hasMore && (
                          <button
                            onClick={() => showMoreCategory(category, filings.length)}
                            className="flex-1 px-4 py-2.5 text-xs font-semibold text-primary-700 hover:bg-blue-50 hover:text-primary-800 transition-all duration-200 flex items-center justify-center gap-1.5"
                          >
                            <span>Show {Math.min(10, filings.length - maxVisible)} more</span>
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                        {isExpanded && (
                          <button
                            onClick={() => showLessCategory(category)}
                            className="flex-1 px-4 py-2.5 text-xs font-semibold text-primary-700 hover:bg-blue-50 hover:text-primary-800 transition-all duration-200 flex items-center justify-center gap-1.5"
                          >
                            <span>Show less</span>
                            <svg
                              className="w-3.5 h-3.5 rotate-180"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Global Empty State - Only if no filings at all */}
        {totalFilings === 0 && (
          <div className="text-center py-12">
            <p className="text-neutral-600">
              No filings found for this company.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
