'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

export type Exchange = 'DART' | 'HKEX';

export interface ExchangeConfig {
  name: string;
  displayName: string;
  countryCode: string;
  language: string;
  searchPlaceholder: string;
  heroTitle: string;
  heroSubtitle: string;
  markets: readonly string[];
}

export const EXCHANGE_CONFIG: Record<Exchange, ExchangeConfig> = {
  DART: {
    name: 'Korea',
    displayName: 'Korea',
    countryCode: 'KR',
    language: 'en',
    searchPlaceholder: 'Search Korean companies and filings...',
    heroTitle: 'Korea Financial Supervisory Service Filings',
    heroSubtitle: 'Browse filings from Korean listed companies',
    markets: ['KOSPI', 'KOSDAQ', 'KONEX'],
  },
  HKEX: {
    name: 'Hong Kong',
    displayName: 'Hong Kong',
    countryCode: 'HK',
    language: 'en',
    searchPlaceholder: 'Search Hong Kong companies and filings...',
    heroTitle: 'Hong Kong Stock Exchange Filings',
    heroSubtitle: 'Browse filings from HKEX listed companies',
    markets: ['SEHK', 'GEM'],
  },
};

interface ExchangeContextValue {
  exchange: Exchange;
  config: ExchangeConfig;
  setExchange: (exchange: Exchange) => void;
  toggleExchange: () => void;
}

const ExchangeContext = createContext<ExchangeContextValue | null>(null);

const STORAGE_KEY = 'asiafilings-exchange';

export function ExchangeProvider({ children }: { children: ReactNode }) {
  const [exchange, setExchangeState] = useState<Exchange>('DART');

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'DART' || stored === 'HKEX') {
      setExchangeState(stored);
    }
  }, []);

  const setExchange = useCallback((newExchange: Exchange) => {
    setExchangeState(newExchange);
    localStorage.setItem(STORAGE_KEY, newExchange);
  }, []);

  const toggleExchange = useCallback(() => {
    const newExchange = exchange === 'DART' ? 'HKEX' : 'DART';
    setExchange(newExchange);
  }, [exchange, setExchange]);

  const value: ExchangeContextValue = {
    exchange,
    config: EXCHANGE_CONFIG[exchange],
    setExchange,
    toggleExchange,
  };

  return (
    <ExchangeContext.Provider value={value}>
      {children}
    </ExchangeContext.Provider>
  );
}

export function useExchange(): ExchangeContextValue {
  const context = useContext(ExchangeContext);
  if (!context) {
    throw new Error('useExchange must be used within an ExchangeProvider');
  }
  return context;
}
