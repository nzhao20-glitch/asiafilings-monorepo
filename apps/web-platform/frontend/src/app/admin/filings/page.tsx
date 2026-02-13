'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilingDataGrid } from '@/src/components/filings/FilingDataGrid';
import { FilingSearchBar } from '@/src/components/filings/FilingSearchBar';
import { FilingFilters } from '@/src/components/filings/FilingFilters';
import { ProcessingStatusPanel } from '@/src/components/filings/ProcessingStatusPanel';
import { apiService } from '@/src/services/api';
import type { Filing, FilingListParams } from '@/src/types/filing';

export default function AdminFilingsPage() {
  const [searchParams, setSearchParams] = useState<FilingListParams>({
    page: 1,
    limit: 50,
    search: '',
    companyId: '',
    filingType: '',
    dateRange: {
      start: '',
      end: ''
    },
    processingStatus: ''
  });

  const { data: filingsData, isLoading, error, refetch } = useQuery({
    queryKey: ['filings', searchParams],
    queryFn: () => apiService.getFilings(searchParams),
    refetchInterval: 30000, // Refresh every 30 seconds for processing status updates
  });

  const handleSearch = (newParams: Partial<FilingListParams>) => {
    setSearchParams(prev => ({ ...prev, ...newParams, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setSearchParams(prev => ({ ...prev, page }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Filing Management System
          </h1>
          <p className="text-gray-600">
            DART API filing synchronization and processing status management (Admin only)
          </p>
        </div>

        {/* Processing Status Overview */}
        <ProcessingStatusPanel className="mb-6" />

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="space-y-4">
            <FilingSearchBar
              value={searchParams.search || ''}
              onSearch={(search) => handleSearch({ search })}
            />
            <FilingFilters
              filters={searchParams}
              onFiltersChange={handleSearch}
            />
          </div>
        </div>

        {/* Data Grid */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <FilingDataGrid
            data={filingsData?.data?.filings || []}
            pagination={filingsData?.data?.pagination}
            loading={isLoading}
            error={error}
            onPageChange={handlePageChange}
            onRefresh={() => refetch()}
          />
        </div>

        {/* Quick Actions */}
        <div className="mt-8 flex gap-4">
          <button
            onClick={() => refetch()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            Refresh Data
          </button>
          <button
            onClick={() => {
              // TODO: Implement manual sync trigger
              console.log('Manual sync triggered');
            }}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            Sync New Filings
          </button>
        </div>
      </div>
    </div>
  );
}