'use client';

import { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import type { Filing } from '@/src/types/document';

interface FilingViewerContextType {
  currentFiling: Filing | null;
  setCurrentFiling: (filing: Filing | null) => void;
  stockCode: string | null;
  setStockCode: (code: string | null) => void;
}

const FilingViewerContext = createContext<FilingViewerContextType | undefined>(undefined);

export function FilingViewerProvider({ children }: { children: ReactNode }) {
  const [currentFiling, setCurrentFiling] = useState<Filing | null>(null);
  const [stockCode, setStockCode] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      currentFiling,
      setCurrentFiling,
      stockCode,
      setStockCode,
    }),
    [currentFiling, stockCode]
  );

  return (
    <FilingViewerContext.Provider value={value}>
      {children}
    </FilingViewerContext.Provider>
  );
}

export function useFilingViewer() {
  const context = useContext(FilingViewerContext);
  if (context === undefined) {
    throw new Error('useFilingViewer must be used within a FilingViewerProvider');
  }
  return context;
}

export type { Filing };
