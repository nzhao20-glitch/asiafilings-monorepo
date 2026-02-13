'use client';

import { useState, useCallback } from 'react';
import { DocumentSearchPopup } from '@/src/components/search/DocumentSearchPopup';

interface CompanyFilingSearchProps {
  stockCode: string;
  companyName: string;
  companyId?: string;
  exchange?: string;
}

export function CompanyFilingSearch({ stockCode, companyName, companyId, exchange }: CompanyFilingSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitSearch = useCallback(() => {
    if (searchQuery.length < 2) return;
    setError(null);
    setSubmittedQuery(searchQuery);
    setShowPopup(true);
  }, [searchQuery]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmitSearch();
    }
  };

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSubmittedQuery('');
    setShowPopup(false);
    setError(null);
  }, []);

  const handleClosePopup = useCallback(() => {
    setShowPopup(false);
  }, []);

  return (
    <div className="relative">
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search company documents... (press Enter)"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="w-full px-4 py-3 pr-20 border-2 border-gray-300 rounded-lg text-sm font-medium text-gray-900 bg-white placeholder:text-gray-500 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
        />

        {/* Search Button and Clear Button */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
              title="Clear search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSubmitSearch}
            disabled={searchQuery.length < 2}
            className="p-1.5 rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
            title="Search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search hint */}
      {searchQuery && searchQuery.length < 2 && (
        <div className="mt-2 text-xs text-gray-500">
          Please enter at least 2 characters
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Full-text Search Popup */}
      {showPopup && submittedQuery.length >= 2 && (
        <DocumentSearchPopup
          query={submittedQuery}
          companyName={companyName}
          companyId={companyId}
          exchange={exchange}
          onClose={handleClosePopup}
        />
      )}
    </div>
  );
}
