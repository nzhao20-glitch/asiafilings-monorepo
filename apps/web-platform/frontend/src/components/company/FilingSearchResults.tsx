'use client';

import { useRouter } from 'next/navigation';
import { DocumentIcon, TableCellsIcon } from '@heroicons/react/24/outline';

interface SearchResult {
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
}

interface FilingSearchResultsProps {
  results: SearchResult[];
  query: string;
  companyName: string;
  onClose: () => void;
}

export function FilingSearchResults({
  results,
  query,
  companyName,
  onClose,
}: FilingSearchResultsProps) {
  const router = useRouter();

  const handleResultClick = (result: SearchResult) => {
    if (!result.rcpNo) {
      console.warn('No rcpNo available for filing:', result.id);
      return;
    }

    // Navigate to filing with search query and page number parameters
    const baseUrl = `/filings/${result.rcpNo}`;
    const params = new URLSearchParams({ q: query });

    // Add page number if available (from cross-document search)
    if (result.pageNumber) {
      params.set('page', result.pageNumber.toString());
    }

    router.push(`${baseUrl}?${params.toString()}`);
  };

  // Highlight matching text in snippet
  const highlightText = (text: string, query: string) => {
    if (!query || !text) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return text;

    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);

    return (
      <>
        {before}
        <span className="bg-yellow-300 font-semibold text-gray-900 px-0.5">
          {match}
        </span>
        {after}
      </>
    );
  };

  // Get icon based on match type
  const getMatchIcon = (matchType: string) => {
    switch (matchType) {
      case 'table':
        return <TableCellsIcon className="h-5 w-5 text-blue-600" />;
      case 'title':
        return <DocumentIcon className="h-5 w-5 text-green-600" />;
      default:
        return <DocumentIcon className="h-5 w-5 text-gray-600" />;
    }
  };

  // Get match type label
  const getMatchTypeLabel = (matchType: string) => {
    switch (matchType) {
      case 'table':
        return 'Table Data';
      case 'title':
        return 'Title';
      case 'text':
        return 'Body Text';
      default:
        return '';
    }
  };

  if (results.length === 0) {
    return (
      <div className="mt-4 p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="text-center py-8">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No Search Results</h3>
          <p className="mt-1 text-sm text-gray-500">
            No results found for "{query}"
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-lg shadow-lg">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Search Results: "{query}"
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {companyName} - {results.length} results
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Results List */}
      <div className="max-h-96 overflow-y-auto">
        {results.map((result, idx) => (
          <button
            key={`${result.id}-${idx}`}
            onClick={() => handleResultClick(result)}
            className="w-full text-left p-4 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0 group"
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex-shrink-0 mt-1">
                {getMatchIcon(result.matchType)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Filing info */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    {result.filingType}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(result.reportDate).toLocaleDateString('en-US')}
                  </span>
                  {result.matchType && (
                    <span className="text-xs text-gray-400">
                      • {getMatchTypeLabel(result.matchType)}
                    </span>
                  )}
                  {result.pageNumber && (
                    <span className="text-xs text-gray-400">
                      • Page {result.pageNumber}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h4 className="text-sm font-medium text-gray-900 mb-1 korean-text group-hover:text-blue-700 transition-colors">
                  {result.title}
                </h4>

                {/* Snippet with highlighted match */}
                <p className="text-sm text-gray-700 leading-relaxed korean-text line-clamp-2">
                  {highlightText(result.snippet, query)}
                </p>

                {/* Click hint */}
                <div className="mt-2 text-xs text-gray-500 group-hover:text-blue-600 transition-colors">
                  Click to view document →
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
