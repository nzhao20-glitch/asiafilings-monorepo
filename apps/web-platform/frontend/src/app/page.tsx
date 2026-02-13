'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/lib/auth-context';
import { useExchange, EXCHANGE_CONFIG, Exchange } from '@/src/contexts/ExchangeContext';
import { apiService } from '@/src/services/api';
import KR from 'country-flag-icons/react/3x2/KR';
import HK from 'country-flag-icons/react/3x2/HK';

const FLAG_COMPONENTS: Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement>>> = { KR, HK };

const EXCHANGE_STATS = {
  DART: {
    companies: '~2,200',
    companiesLabel: 'Listed Companies',
    filings: '~110,000',
    filingsLabel: 'Annual Filings',
  },
  HKEX: {
    companies: '~2,600',
    companiesLabel: 'Listed Companies',
    filings: '~180,000',
    filingsLabel: 'Annual Filings',
  },
} as const;

interface Company {
  id: string;
  name: string;
  stockCode: string;
  marketType: string;
}

const FEATURES = [
  {
    title: 'Full-Text Search',
    description: 'Search across all filings with instant full-text search powered by Quickwit. Find exactly what you need in seconds.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    title: 'Multi-Market Coverage',
    description: 'Access filings from Korea (DART) and Hong Kong (HKEX) exchanges in one unified platform.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Document Viewer',
    description: 'View filings directly in the browser with our built-in PDF viewer, complete with search highlighting.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: 'Real-Time Updates',
    description: 'Filings are synced daily from regulatory sources so you always have the latest data available.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
];

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { exchange, setExchange, config: exchangeConfig } = useExchange();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: searchResults } = useQuery({
    queryKey: ['company-search', searchQuery, exchange],
    queryFn: () => apiService.searchCompanies(searchQuery, exchange),
    enabled: searchQuery.length >= 1,
    staleTime: 5 * 60 * 1000,
  });

  const suggestions = (searchResults?.data || []).slice(0, 8);
  const stats = EXCHANGE_STATS[exchange];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length >= 1 && suggestions.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [suggestions, searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    if (searchQuery.trim()) {
      router.push(`/filings?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push('/filings');
    }
  };

  const handleSuggestionClick = (company: Company) => {
    setSearchQuery('');
    setShowSuggestions(false);
    router.push(`/companies/${exchange}/${company.stockCode}`);
  };

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary-700 to-secondary-700" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent" />

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-4 tracking-tight">
            Asian financial filings
            <br />
            <span className="text-primary-200">made accessible</span>
          </h1>
          <p className="text-lg sm:text-xl text-primary-100 mb-10 max-w-2xl mx-auto">
            Search and analyze regulatory filings from Korea and Hong Kong stock exchanges.
          </p>

          {/* Exchange Tabs */}
          <div className="inline-flex items-center bg-white/10 backdrop-blur-sm rounded-full p-1 mb-6">
            {(Object.keys(EXCHANGE_CONFIG) as Exchange[]).map((ex) => {
              const cfg = EXCHANGE_CONFIG[ex];
              const Flag = FLAG_COMPONENTS[cfg.countryCode];
              return (
                <button
                  key={ex}
                  onClick={() => setExchange(ex)}
                  className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
                    exchange === ex
                      ? 'bg-white text-primary-700 shadow-md'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {Flag && <Flag className="w-5 h-3.5 rounded-sm" />}
                  {cfg.displayName}
                </button>
              );
            })}
          </div>

          {/* Search Bar */}
          <div className="max-w-2xl mx-auto" ref={searchRef}>
            <form onSubmit={handleSearch} className="relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder={exchangeConfig.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchQuery.length >= 1 && suggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full px-6 py-4 pr-14 text-base text-neutral-900 bg-white rounded-2xl shadow-lg border-2 border-transparent focus:outline-none focus:border-primary-300 focus:shadow-xl transition-all duration-200 placeholder-neutral-400"
                />
                <button
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>

              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-2 bg-white border border-neutral-200 rounded-xl shadow-xl max-h-64 overflow-y-auto text-left">
                  {suggestions.map((company: Company, index: number) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => handleSuggestionClick(company)}
                      className={`w-full px-5 py-3 text-left hover:bg-primary-50 focus:bg-primary-50 focus:outline-none transition-colors ${
                        index !== suggestions.length - 1 ? 'border-b border-neutral-100' : ''
                      } ${index === 0 ? 'rounded-t-xl' : ''} ${index === suggestions.length - 1 ? 'rounded-b-xl' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-neutral-900">{company.name}</span>
                          <span className="ml-2 text-sm text-primary-600">({company.stockCode})</span>
                        </div>
                        <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2.5 py-1 rounded-lg border border-primary-200">
                          {company.marketType}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </form>

            <p className="text-sm text-primary-200 mt-4">
              Search by company name or stock code
            </p>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
        <div className="bg-white rounded-2xl shadow-lg border border-neutral-200 p-6">
          <div className="grid grid-cols-3 divide-x divide-neutral-200 text-center">
            <div>
              <div className="text-2xl sm:text-3xl font-bold text-primary-700">{stats.companies}</div>
              <div className="text-sm text-neutral-600 mt-1">{stats.companiesLabel}</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-bold text-primary-700">{stats.filings}</div>
              <div className="text-sm text-neutral-600 mt-1">{stats.filingsLabel}</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-bold text-primary-700">2</div>
              <div className="text-sm text-neutral-600 mt-1">Exchanges</div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900 text-center mb-3">
          Everything you need for filing research
        </h2>
        <p className="text-neutral-600 text-center mb-12 max-w-xl mx-auto">
          Built for institutional investors and analysts covering Asian markets.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="bg-white rounded-xl p-6 border border-neutral-200 hover:border-primary-200 hover:shadow-md transition-all duration-200"
            >
              <div className="w-10 h-10 bg-primary-50 text-primary-600 rounded-lg flex items-center justify-center mb-4">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      {!authLoading && !user && (
        <div className="bg-gradient-to-r from-primary-600 to-secondary-600 py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Get started for free
            </h2>
            <p className="text-primary-100 mb-8 max-w-lg mx-auto">
              Create an account to search, browse, and analyze filings from Korean and Hong Kong exchanges.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => router.push('/register')}
                className="px-8 py-3 bg-white text-primary-700 font-semibold rounded-xl hover:bg-primary-50 transition-colors shadow-md"
              >
                Create Free Account
              </button>
              <button
                onClick={() => router.push('/login')}
                className="px-8 py-3 bg-white/10 text-white font-semibold rounded-xl border border-white/30 hover:bg-white/20 transition-colors"
              >
                Log In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-neutral-200 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">AF</span>
              </div>
              <span className="text-sm font-semibold text-neutral-700">AsiaFilings</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-neutral-500">
              <button onClick={() => router.push('/features')} className="hover:text-neutral-700 transition-colors">Features</button>
              <button onClick={() => router.push('/pricing')} className="hover:text-neutral-700 transition-colors">Pricing</button>
              <button onClick={() => router.push('/contact')} className="hover:text-neutral-700 transition-colors">Contact</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
