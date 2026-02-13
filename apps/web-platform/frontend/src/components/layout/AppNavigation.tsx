'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/lib/auth-context';
import { useExchange } from '@/src/contexts/ExchangeContext';
import { ExchangeToggle } from './ExchangeToggle';
import { apiService } from '@/src/services/api';

interface NavigationItem {
  name: string;
  path: string;
  icon: string;
  adminOnly?: boolean;
}

const navigationItems: NavigationItem[] = [
  { name: 'Features', path: '/features', icon: '✨' },
  { name: 'Pricing', path: '/pricing', icon: '💰' },
  { name: 'Contact Us', path: '/contact', icon: '📧' },
  { name: 'Admin', path: '/admin', icon: '⚙️', adminOnly: true },
];

interface Company {
  id: string;
  name: string;
  stockCode: string;
  marketType: string;
}

function AppNavigationContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, logout } = useAuth();
  const { exchange, config: exchangeConfig } = useExchange();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Search for company suggestions with exchange filter
  const { data: searchResults } = useQuery({
    queryKey: ['company-search', searchQuery, exchange],
    queryFn: () => apiService.searchCompanies(searchQuery, exchange),
    enabled: searchQuery.length >= 1,
    staleTime: 5 * 60 * 1000,
  });

  const suggestions = (searchResults?.data || []).slice(0, 10); // Max 10 suggestions

  // Sync search query with URL params when on filings page
  useEffect(() => {
    if (pathname === '/filings') {
      const urlQuery = searchParams.get('q');
      setSearchQuery(urlQuery || '');
    } else {
      // Clear search when not on filings page
      setSearchQuery('');
    }
  }, [pathname, searchParams]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Show suggestions when there are results
  useEffect(() => {
    if (searchQuery.length >= 1 && suggestions.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [suggestions, searchQuery]);

  // Don't show navigation on auth pages or filing detail pages
  if (pathname === '/login' || pathname === '/register' || pathname?.startsWith('/filings/')) {
    return null;
  }

  if (!user) {
    return null;
  }

  const filteredNavItems = navigationItems.filter(item =>
    !item.adminOnly || user.role === 'admin'
  );

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
    <nav className="relative bg-white shadow-elevated border-b border-primary-100 sticky top-0 z-[100] backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-4">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <div className="flex items-center space-x-2 cursor-pointer" onClick={() => router.push('/')}>
              <div className="w-9 h-9 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 rounded-xl flex items-center justify-center shadow-medium hover:shadow-glow-blue transition-all duration-300 hover:scale-105">
                <span className="text-white font-bold text-sm">AF</span>
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-primary-700 to-secondary-600 bg-clip-text text-transparent hidden lg:block">
                AsiaFilings
              </h1>
              <h1 className="text-lg font-bold bg-gradient-to-r from-primary-700 to-secondary-600 bg-clip-text text-transparent hidden md:block lg:hidden">
                AsiaFilings
              </h1>
            </div>
          </div>

          {/* Search Bar (Desktop) */}
          <div className="hidden md:flex flex-1 max-w-2xl" ref={searchRef}>
            <form onSubmit={handleSearch} className="w-full relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder={exchangeConfig.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchQuery.length >= 1 && suggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full px-4 py-2.5 pr-10 border-2 border-primary-200 rounded-xl text-sm text-black bg-white shadow-inner-soft focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 focus:shadow-glow-blue transition-all duration-200"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary-500 hover:text-primary-700 hover:bg-primary-50 transition-all duration-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>

              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-2 bg-white border border-primary-200 rounded-xl shadow-strong max-h-48 dropdown-scroll backdrop-blur-sm">
                  {suggestions.map((company: Company, index: number) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => handleSuggestionClick(company)}
                      className={`w-full px-4 py-3 text-left hover:bg-gradient-to-r hover:from-primary-50 hover:to-secondary-50 focus:bg-primary-50 focus:outline-none transition-all duration-200 ${
                        index === suggestions.length - 1 ? '' : 'border-b border-primary-100'
                      } ${index === 0 ? 'rounded-t-xl' : ''} ${index === suggestions.length - 1 ? 'rounded-b-xl' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-neutral-900">{company.name}</span>
                          <span className="ml-2 text-sm text-primary-600">({company.stockCode})</span>
                        </div>
                        <span className="text-xs font-medium text-primary-700 bg-gradient-to-r from-primary-100 to-secondary-100 px-2.5 py-1 rounded-lg shadow-soft">
                          {company.marketType}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>

          {/* Right side: Navigation items */}
          <div className="hidden md:flex items-center space-x-2">
            {/* Exchange Toggle */}
            <ExchangeToggle />

            {/* Desktop Navigation */}
            {filteredNavItems.map((item) => {
              const isActive = pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-medium'
                      : 'text-neutral-700 hover:bg-gradient-to-r hover:from-primary-50 hover:to-secondary-50 hover:text-primary-700 hover:shadow-soft'
                  }`}
                >
                  <span className="mr-2 text-base">{item.icon}</span>
                  {item.name}
                </button>
              );
            })}
          </div>

          {/* User menu - Far right */}
          <div className="hidden md:flex items-center pl-4 border-l border-neutral-300">
            <button
              onClick={logout}
              className="text-sm text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 px-4 py-2 rounded-xl border-2 border-primary-600 hover:border-primary-700 transition-all duration-200 font-bold shadow-medium hover:shadow-strong"
            >
              Logout
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-lg text-neutral-800 hover:text-primary-700 hover:bg-primary-50 transition-colors border-2 border-neutral-300 hover:border-primary-400"
            >
              <span className="sr-only">Open main menu</span>
              {isMobileMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-neutral-200">
          {/* Mobile Search */}
          <div className="px-4 pt-4 pb-3">
            <form onSubmit={(e) => { handleSearch(e); setIsMobileMenuOpen(false); }} className="relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder={exchangeConfig.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 pr-10 border border-neutral-300 rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary-500 hover:text-primary-700 hover:bg-primary-50 transition-all duration-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>

              {/* Mobile Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-[calc(100%-2rem)] mt-2 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-48 dropdown-scroll">
                  {suggestions.map((company: Company, index: number) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => { handleSuggestionClick(company); setIsMobileMenuOpen(false); }}
                      className={`w-full px-4 py-3 text-left hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none transition-colors ${
                        index === suggestions.length - 1 ? '' : 'border-b border-neutral-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-neutral-900 text-sm">{company.name}</span>
                          <span className="ml-2 text-xs text-neutral-500">({company.stockCode})</span>
                        </div>
                        <span className="text-xs text-neutral-400 bg-neutral-100 px-2 py-1 rounded ml-2 flex-shrink-0">
                          {company.marketType}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>

          {/* Mobile Exchange Toggle */}
          <div className="px-4 pb-3">
            <ExchangeToggle className="w-full justify-center" />
          </div>

          {/* Mobile Navigation Items */}
          {filteredNavItems.length > 0 && (
            <div className="px-2 pb-3 space-y-1">
              {filteredNavItems.map((item) => {
                const isActive = pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      router.push(item.path);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-3 text-base font-medium rounded-lg transition-all ${
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                    }`}
                  >
                    <span className="mr-2 text-lg">{item.icon}</span>
                    {item.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Mobile user menu */}
          <div className="pt-4 pb-3 border-t border-neutral-300 bg-neutral-50">
            <div className="px-2">
              <button
                onClick={logout}
                className="block w-full text-center px-4 py-2 text-base font-bold text-white bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 rounded-lg transition-all shadow-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

export function AppNavigation() {
  return (
    <Suspense fallback={
      <nav className="relative bg-white shadow-elevated border-b border-primary-100 sticky top-0 z-[100] backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex-shrink-0 flex items-center">
              <div className="w-9 h-9 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 rounded-xl flex items-center justify-center shadow-medium">
                <span className="text-white font-bold text-sm">AF</span>
              </div>
            </div>
          </div>
        </div>
      </nav>
    }>
      <AppNavigationContent />
    </Suspense>
  );
}