'use client';

import { useState } from 'react';
import type { FilingListParams } from '@/src/types/filing';

interface FilingFiltersProps {
  filters: FilingListParams;
  onFiltersChange: (filters: Partial<FilingListParams>) => void;
}

export function FilingFilters({ filters, onFiltersChange }: FilingFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const filingTypes = [
    { value: '', label: 'All Reports' },
    { value: 'A001', label: 'Annual Report' },
    { value: 'A002', label: 'Semi-Annual Report' },
    { value: 'A003', label: 'Quarterly Report' },
    { value: 'A004', label: 'Registration Statement' },
    { value: 'A005', label: 'Prospectus' },
  ];

  const processingStatuses = [
    { value: '', label: 'All Statuses' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'PROCESSING', label: 'Processing' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'FAILED', label: 'Failed' },
  ];

  const handleDateChange = (field: 'start' | 'end', value: string) => {
    onFiltersChange({
      dateRange: {
        start: filters.dateRange?.start || '',
        end: filters.dateRange?.end || '',
        [field]: value,
      },
    });
  };

  const handleClearFilters = () => {
    onFiltersChange({
      filingType: '',
      processingStatus: '',
      dateRange: { start: '', end: '' },
      companyId: '',
    });
  };

  const hasActiveFilters =
    filters.filingType ||
    filters.processingStatus ||
    filters.dateRange?.start ||
    filters.dateRange?.end ||
    filters.companyId;

  return (
    <div className="space-y-4">
      {/* Basic Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label htmlFor="filingType" className="block text-sm font-medium text-gray-700 mb-1">
            Report Type
          </label>
          <select
            id="filingType"
            value={filters.filingType || ''}
            onChange={(e) => onFiltersChange({ filingType: e.target.value })}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            {filingTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="processingStatus" className="block text-sm font-medium text-gray-700 mb-1">
            Processing Status
          </label>
          <select
            id="processingStatus"
            value={filters.processingStatus || ''}
            onChange={(e) => onFiltersChange({ processingStatus: e.target.value })}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            {processingStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
            Start Date
          </label>
          <input
            type="date"
            id="startDate"
            value={filters.dateRange?.start || ''}
            onChange={(e) => handleDateChange('start', e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>

        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
            End Date
          </label>
          <input
            type="date"
            id="endDate"
            value={filters.dateRange?.end || ''}
            onChange={(e) => handleDateChange('end', e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Advanced Filters Toggle */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
        >
          <span>{showAdvanced ? 'Simple Filters' : 'Advanced Filters'}</span>
          <svg
            className={`ml-1 h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-sm text-gray-600 hover:text-gray-800 font-medium flex items-center"
          >
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Clear Filters
          </button>
        )}
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <div>
            <label htmlFor="companyId" className="block text-sm font-medium text-gray-700 mb-1">
              Company ID
            </label>
            <input
              type="text"
              id="companyId"
              value={filters.companyId || ''}
              onChange={(e) => onFiltersChange({ companyId: e.target.value })}
              placeholder="Enter company ID"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={filters.sortBy || 'reportDate'}
                onChange={(e) => onFiltersChange({ sortBy: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="reportDate">Report Date</option>
                <option value="receiptDate">Receipt Date</option>
                <option value="companyName">Company Name</option>
                <option value="processingStatus">Processing Status</option>
                <option value="createdAt">Created Date</option>
              </select>
              <select
                value={filters.sortOrder || 'desc'}
                onChange={(e) => onFiltersChange({ sortOrder: e.target.value as 'asc' | 'desc' })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 pt-2">
          <span className="text-sm text-gray-500">Active Filters:</span>
          {filters.filingType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              Type: {filingTypes.find(t => t.value === filters.filingType)?.label}
              <button
                onClick={() => onFiltersChange({ filingType: '' })}
                className="ml-1 inline-flex items-center justify-center w-4 h-4 text-blue-400 hover:text-blue-600"
              >
                ×
              </button>
            </span>
          )}
          {filters.processingStatus && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Status: {processingStatuses.find(s => s.value === filters.processingStatus)?.label}
              <button
                onClick={() => onFiltersChange({ processingStatus: '' })}
                className="ml-1 inline-flex items-center justify-center w-4 h-4 text-green-400 hover:text-green-600"
              >
                ×
              </button>
            </span>
          )}
          {(filters.dateRange?.start || filters.dateRange?.end) && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
              Date: {filters.dateRange?.start || 'Start'} ~ {filters.dateRange?.end || 'End'}
              <button
                onClick={() => onFiltersChange({ dateRange: { start: '', end: '' } })}
                className="ml-1 inline-flex items-center justify-center w-4 h-4 text-purple-400 hover:text-purple-600"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}