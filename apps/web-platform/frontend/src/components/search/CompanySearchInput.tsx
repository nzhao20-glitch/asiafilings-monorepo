'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';

interface Company {
  id: string;
  name: string;
  stockCode: string;
  marketType: string;
}

interface CompanySearchInputProps {
  onCompanySelect: (company: Company) => void;
  placeholder?: string;
  initialQuery?: string;
}

export function CompanySearchInput({ onCompanySelect, placeholder = "Enter company name or stock code... (e.g., Samsung, 005930)", initialQuery = '' }: CompanySearchInputProps) {
  const [query, setQuery] = useState(initialQuery);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Update query when initialQuery prop changes
  useEffect(() => {
    if (initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Search companies with debouncing
  const { data: searchResults, isLoading, error } = useQuery({
    queryKey: ['company-search', query],
    queryFn: () => {
      console.log('🔍 Making API call for query:', query);
      return apiService.searchCompanies(query);
    },
    enabled: query.length >= 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const companies = searchResults?.data || [];

  // Debug logging
  console.log('🐛 Search Debug:', {
    query,
    queryLength: query.length,
    searchResults: !!searchResults,
    companies: companies.length,
    error: error?.message,
    isLoading
  });

  useEffect(() => {
    if (query.length >= 1) {
      if (companies.length > 0) {
        setIsOpen(true);
        setSelectedIndex(-1);
      } else if (!isLoading) {
        // Show dropdown even with no results for better UX
        setIsOpen(true);
      }
    } else {
      setIsOpen(false);
    }
  }, [companies, query.length, isLoading]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || companies.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < companies.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < companies.length) {
          handleCompanySelect(companies[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleCompanySelect = (company: Company) => {
    setQuery(company.name);
    setIsOpen(false);
    setSelectedIndex(-1);


    onCompanySelect(company);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (value.length < 1) {
      setIsOpen(false);
    }
  };

  const handleInputFocus = () => {
    if (companies.length > 0 && query.length >= 1) {
      setIsOpen(true);
    }
  };

  const handleInputBlur = () => {
    // Delay closing to allow for click events on suggestions
    setTimeout(() => setIsOpen(false), 150);
  };

  const formatCompanyDisplay = (company: Company) => {
    return (
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-gray-900">{company.name}</span>
          <span className="ml-2 text-sm text-gray-500">({company.stockCode})</span>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
          {company.marketType}
        </span>
      </div>
    );
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          className="block w-full pl-14 pr-4 py-4 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm"
        />
        {isLoading && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          </div>
        )}
      </div>

      {/* Search Results Dropdown */}
      {isOpen && companies.length > 0 && (
        <div
          ref={resultsRef}
          className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 dropdown-scroll"
        >
          {companies.map((company: Company, index: number) => (
            <button
              key={company.id}
              onClick={() => handleCompanySelect(company)}
              className={`w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                index === selectedIndex ? 'bg-blue-50 border-l-4 border-blue-500' : ''
              } ${index === companies.length - 1 ? '' : 'border-b border-gray-100'}`}
            >
              {formatCompanyDisplay(company)}
            </button>
          ))}
        </div>
      )}

      {/* No Results */}
      {isOpen && !isLoading && query.length >= 1 && companies.length === 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4">
          <div className="text-center text-gray-500">
            <svg className="mx-auto h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8c0 2.152-.848 4.103-2.229 5.291z" />
            </svg>
            <p className="text-sm">No results found for "{query}".</p>
            <p className="text-xs text-gray-400 mt-1">Try entering the exact company name or stock code.</p>
          </div>
        </div>
      )}
    </div>
  );
}