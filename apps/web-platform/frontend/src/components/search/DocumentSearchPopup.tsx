'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiService } from '@/src/services/api';
import { toFilingResults } from '@/src/utils/quickwit-helpers';
import type { FilingResult } from '@/src/utils/quickwit-helpers';
import { categorizeFilingType, categoryConfig, categoryOrder, decodeHtmlEntities } from '@/src/utils/filing-categories';
import type { FilingCategory } from '@/src/utils/filing-categories';
import { SearchPDFViewer } from './SearchPDFViewer';

interface DocumentSearchPopupProps {
  query: string;
  companyName: string;
  companyId?: string;
  exchange?: string;
  onClose: () => void;
}

export function DocumentSearchPopup({ query, companyName, companyId, exchange, onClose }: DocumentSearchPopupProps) {
  const [groupedFilings, setGroupedFilings] = useState<FilingResult[]>([]);
  const [selectedFilingIndex, setSelectedFilingIndex] = useState(0);
  const [selectedPageMatchIndex, setSelectedPageMatchIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categoryVisibleCount, setCategoryVisibleCount] = useState<Record<string, number>>({});

  const scrollToPageRef = useRef<((pageNumber: number) => void) | null>(null);
  const matchListRef = useRef<HTMLDivElement>(null);

  const PDF_SCALE = 1.3;
  const INITIAL_VISIBLE = 5;
  const LOAD_MORE_COUNT = 10;

  const getVisibleCount = (category: string) => categoryVisibleCount[category] ?? INITIAL_VISIBLE;

  const handleShowMore = (category: string, totalCount: number) => {
    setCategoryVisibleCount(prev => ({
      ...prev,
      [category]: Math.min((prev[category] ?? INITIAL_VISIBLE) + LOAD_MORE_COUNT, totalCount),
    }));
  };

  // Fetch search results on mount
  useEffect(() => {
    const fetchResults = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await apiService.fullTextSearch(query, companyId, exchange);
        const grouped = toFilingResults(response.results || []);
        setGroupedFilings(grouped);
        setSelectedFilingIndex(0);
        setSelectedPageMatchIndex(0);
      } catch (err) {
        console.error('Full-text search failed:', err);
        setError('Search failed. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [query, companyId, exchange]);

  const selectedFiling = groupedFilings[selectedFilingIndex];
  const pageMatches = selectedFiling?.matches || [];

  const totalPageCount = useMemo(
    () => groupedFilings.reduce((sum, f) => sum + f.matchedPageCount, 0),
    [groupedFilings]
  );

  // Group filings by category, preserving their flat index for selection
  const filingsByCategory = useMemo(() => {
    const grouped: Record<FilingCategory, { filing: FilingResult; flatIndex: number }[]> = {
      financials: [], news: [], ownership: [], proxies: [], prospectuses: [], related_party: [], other: [],
    };

    groupedFilings.forEach((filing, idx) => {
      const category = categorizeFilingType(filing.filingType, filing.title);
      grouped[category].push({ filing, flatIndex: idx });
    });

    return grouped;
  }, [groupedFilings]);

  // Only show categories that have filings
  const activeCategories = useMemo(
    () => categoryOrder.filter(cat => filingsByCategory[cat].length > 0),
    [filingsByCategory]
  );

  const handleSelectFiling = useCallback((index: number) => {
    setSelectedFilingIndex(index);
    setSelectedPageMatchIndex(0);
  }, []);

  const handleSelectPageMatch = useCallback((index: number) => {
    setSelectedPageMatchIndex(index);
    const match = pageMatches[index];
    if (match) {
      scrollToPageRef.current?.(match.pageNumber);
    }
  }, [pageMatches]);

  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedPageMatchIndex(prev => {
          const next = Math.min(prev + 1, pageMatches.length - 1);
          const match = pageMatches[next];
          if (match) scrollToPageRef.current?.(match.pageNumber);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedPageMatchIndex(prev => {
          const next = Math.max(prev - 1, 0);
          const match = pageMatches[next];
          if (match) scrollToPageRef.current?.(match.pageNumber);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, pageMatches]);

  // Scroll active match entry into view
  useEffect(() => {
    if (!matchListRef.current) return;
    const activeEl = matchListRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedPageMatchIndex]);



  const pdfUrl = selectedFiling ? `/api/files/${selectedFiling.s3Key}` : '';

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed top-16 left-0 right-0 bottom-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
        style={{ width: '65%', height: '80%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Search: &apos;{query}&apos; in {companyName}
            </h2>
            {!isLoading && (
              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                {totalPageCount} page{totalPageCount !== 1 ? 's' : ''} in {groupedFilings.length} filing{groupedFilings.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedFiling && (
              <a
                href={`/filings/${selectedFiling.documentId}?page=${pageMatches[selectedPageMatchIndex]?.pageNumber ?? 1}&q=${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                title="Open in filing viewer"
              >
                Open Document
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-600 hover:text-red-600 hover:bg-red-50 border border-gray-300 transition-colors"
              title="Close (Esc)"
            >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        {/* Body — Three Columns */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel — Categorized Filing List (25%) */}
          <div className="w-[25%] border-r border-gray-200 overflow-y-auto bg-white">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-red-600">{error}</div>
            ) : groupedFilings.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              <div>
                {activeCategories.map((category) => {
                  const config = categoryConfig[category];
                  const filings = filingsByCategory[category];

                  return (
                    <div key={category}>
                      {/* Category Header */}
                      <div className="sticky top-0 z-10 bg-blue-50 border-b border-blue-100 px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-xs">{config.icon}</span>
                        <span className="text-[11px] font-semibold text-blue-900">{config.name}</span>
                        <span className="text-[10px] text-blue-600 bg-white px-1.5 py-0.5 rounded-full font-medium">
                          {filings.length}
                        </span>
                      </div>
                      {/* Filing Entries */}
                      <div className="divide-y divide-gray-100">
                        {filings.slice(0, getVisibleCount(category)).map(({ filing, flatIndex }) => (
                          <button
                            key={filing.documentId}
                            onClick={() => handleSelectFiling(flatIndex)}
                            className={`w-full text-left px-3 py-2 transition-colors ${
                              flatIndex === selectedFilingIndex
                                ? 'bg-blue-50 border-l-2 border-blue-500'
                                : 'hover:bg-gray-50 border-l-2 border-transparent'
                            }`}
                          >
                            <p className="text-xs font-medium text-gray-900 truncate">
                              {decodeHtmlEntities(filing.title)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-gray-500">{formatDate(filing.filingDate)}</span>
                              {filing.filingType && (
                                <span className="text-[10px] text-blue-700 bg-blue-100 px-1 py-0.5 rounded">
                                  {decodeHtmlEntities(filing.filingType)}
                                </span>
                              )}
                              <span className="text-[10px] text-orange-700 bg-orange-100 px-1 py-0.5 rounded font-medium">
                                {filing.matchedPageCount} pg{filing.matchedPageCount !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </button>
                        ))}
                        {getVisibleCount(category) < filings.length && (
                          <button
                            onClick={() => handleShowMore(category, filings.length)}
                            className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <span>Show {Math.min(LOAD_MORE_COUNT, filings.length - getVisibleCount(category))} more</span>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Middle Panel — Page Match List (20%) */}
          <div className="w-[20%] border-r border-gray-200 overflow-y-auto bg-white" ref={matchListRef}>
            {selectedFiling && pageMatches.length > 0 ? (
              <>
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <p className="text-xs font-medium text-gray-700">
                    Matches in {pageMatches.length} page{pageMatches.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="divide-y divide-gray-100">
                  {pageMatches.map((match, idx) => (
                    <button
                      key={match.pageNumber}
                      data-active={idx === selectedPageMatchIndex ? 'true' : undefined}
                      onClick={() => handleSelectPageMatch(idx)}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        idx === selectedPageMatchIndex
                          ? 'bg-yellow-50 border-l-2 border-yellow-500'
                          : 'hover:bg-gray-50 border-l-2 border-transparent'
                      }`}
                    >
                      {match.snippet ? (
                        <p className="text-[11px] text-gray-700 line-clamp-3 leading-tight">
                          {match.snippet}
                        </p>
                      ) : (
                        <span className="text-xs text-gray-500">Page {match.pageNumber}</span>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-gray-400">p. {match.pageNumber}</span>
                        <span className="text-[10px] text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded-full font-medium">
                          {match.matchCount}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : selectedFiling ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">
                No matches
              </div>
            ) : !isLoading ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">
                Select a filing
              </div>
            ) : null}
          </div>

          {/* Right Panel — Full PDF Viewer (55%) */}
          <div className="w-[55%] flex flex-col bg-gray-100 min-h-0">
            {selectedFiling ? (
              <SearchPDFViewer
                pdfUrl={pdfUrl}
                matchedPages={selectedFiling.matchedPages}
                query={query}
                scale={PDF_SCALE}
                documentId={selectedFiling.documentId}
                scrollToPageRef={scrollToPageRef}
              />
            ) : !isLoading && groupedFilings.length > 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-500">
                Select a filing to view matches
              </div>
            ) : !isLoading && groupedFilings.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-500">
                No results to display
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
