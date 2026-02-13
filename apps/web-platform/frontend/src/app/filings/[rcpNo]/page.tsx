'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useFilingViewer } from '@/src/contexts/FilingViewerContext';
import { apiService } from '@/src/services/api';
import { useEffect, useMemo } from 'react';

export default function FilingDetailPage() {
  const params = useParams();
  const rcpNo = params.rcpNo as string;
  const { setCurrentFiling, setStockCode } = useFilingViewer();

  // Fetch filing details by receipt number (optional for now with dummy data)
  const { data: filingData, isLoading, error } = useQuery({
    queryKey: ['filing', rcpNo],
    queryFn: () => apiService.getFilingByRcpNo(rcpNo),
    enabled: !!rcpNo,
    retry: false, // Don't retry on 404
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes (formerly cacheTime)
  });

  // Memoize the dummy filing data to prevent recreating it on every render
  const dummyFiling = useMemo(() => ({
    id: 'dummy',
    companyId: 'dummy',
    title: `Filing Document (rcpNo: ${rcpNo})`,
    filingType: 'Sample Document',
    reportDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`,
    exchange: 'DART' as const,
    language: 'KO' as const,
    processingStatus: 'PENDING' as const,
    company: {
      id: 'dummy-company',
      stockCode: '005930',
      companyName: 'Sample Company',
      marketType: 'KOSPI' as const,
      exchange: 'DART' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }), [rcpNo]);

  // Use dummy filing if there's an error (404) or no data
  // Parse dates from API response (they come as strings)
  const filing = (error || !filingData) ? dummyFiling : {
    ...filingData.data,
    reportDate: filingData.data.reportDate ? new Date(filingData.data.reportDate) : new Date(),
    createdAt: filingData.data.createdAt ? new Date(filingData.data.createdAt) : new Date(),
    updatedAt: filingData.data.updatedAt ? new Date(filingData.data.updatedAt) : new Date(),
    ingestedAt: filingData.data.ingestedAt ? new Date(filingData.data.ingestedAt) : undefined,
  };

  // Update context when filing ID changes (not when object reference changes)
  useEffect(() => {
    if (filing) {
      setCurrentFiling(filing);
      setStockCode(filing.company?.stockCode || null);
    }
  }, [filing.id, filing.company?.stockCode, setCurrentFiling, setStockCode]);

  // This page component just updates the context
  // The actual rendering happens in the layout
  return null;
}