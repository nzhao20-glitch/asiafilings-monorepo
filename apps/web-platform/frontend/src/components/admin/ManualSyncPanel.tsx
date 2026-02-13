'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';

interface SyncConfig {
  type: 'companies' | 'filings';
  companyId?: string;
  startDate?: string;
  endDate?: string;
  force?: boolean;
}

export function ManualSyncPanel() {
  const [config, setConfig] = useState<SyncConfig>({
    type: 'companies',
    force: false,
  });
  const [isAdvanced, setIsAdvanced] = useState(false);

  const queryClient = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: (data: SyncConfig) => apiService.triggerSync(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['processing-stats'] });
    },
  });

  const handleSync = () => {
    syncMutation.mutate(config);
  };

  const today = new Date().toISOString().split('T')[0];
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-gray-900">Manual Sync</h3>
        <button
          onClick={() => setIsAdvanced(!isAdvanced)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {isAdvanced ? 'Simple Settings' : 'Advanced Settings'}
        </button>
      </div>

      <div className="space-y-6">
        {/* Sync Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Sync Type</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="relative">
              <input
                type="radio"
                value="companies"
                checked={config.type === 'companies'}
                onChange={(e) => setConfig({ ...config, type: e.target.value as 'companies' })}
                className="sr-only"
              />
              <div className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                config.type === 'companies'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}>
                <div className="flex items-center">
                  <div className="text-2xl mr-3">🏢</div>
                  <div>
                    <div className="font-medium text-gray-900">Company Info Sync</div>
                    <div className="text-sm text-gray-500">Fetch latest company list from DART</div>
                  </div>
                </div>
              </div>
            </label>

            <label className="relative">
              <input
                type="radio"
                value="filings"
                checked={config.type === 'filings'}
                onChange={(e) => setConfig({ ...config, type: e.target.value as 'filings' })}
                className="sr-only"
              />
              <div className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                config.type === 'filings'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}>
                <div className="flex items-center">
                  <div className="text-2xl mr-3">📄</div>
                  <div>
                    <div className="font-medium text-gray-900">Filing Sync</div>
                    <div className="text-sm text-gray-500">Fetch latest filing documents</div>
                  </div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Advanced Options */}
        {isAdvanced && (
          <div className="bg-gray-50 rounded-lg p-4 space-y-4">
            <h4 className="font-medium text-gray-900">Advanced Options</h4>

            {config.type === 'filings' && (
              <>
                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      id="startDate"
                      value={config.startDate || oneMonthAgo}
                      onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
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
                      value={config.endDate || today}
                      onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                </div>

                {/* Company ID */}
                <div>
                  <label htmlFor="companyId" className="block text-sm font-medium text-gray-700 mb-1">
                    Specific Company ID (Optional)
                  </label>
                  <input
                    type="text"
                    id="companyId"
                    value={config.companyId || ''}
                    onChange={(e) => setConfig({ ...config, companyId: e.target.value })}
                    placeholder="e.g., 00126380 (Samsung Electronics)"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Leave empty to sync filings for all companies
                  </p>
                </div>
              </>
            )}

            {/* Force Option */}
            <div className="flex items-center">
              <input
                id="force"
                type="checkbox"
                checked={config.force || false}
                onChange={(e) => setConfig({ ...config, force: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="force" className="ml-2 block text-sm text-gray-900">
                Force Sync (Overwrite existing data)
              </label>
            </div>
          </div>
        )}

        {/* Quick Presets */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Quick Presets</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              onClick={() => setConfig({
                type: 'filings',
                startDate: today,
                endDate: today,
                force: false,
              })}
              className="text-left p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <div className="font-medium text-sm">Today's Filings</div>
              <div className="text-xs text-gray-500">Documents filed today</div>
            </button>
            <button
              onClick={() => setConfig({
                type: 'filings',
                startDate: oneMonthAgo,
                endDate: today,
                force: false,
              })}
              className="text-left p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <div className="font-medium text-sm">Last Month</div>
              <div className="text-xs text-gray-500">Filings from past 30 days</div>
            </button>
            <button
              onClick={() => setConfig({
                type: 'companies',
                force: true,
              })}
              className="text-left p-3 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
            >
              <div className="font-medium text-sm">All Companies</div>
              <div className="text-xs text-gray-500">Refresh all company data</div>
            </button>
          </div>
        </div>

        {/* Sync Button */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            {syncMutation.isSuccess && (
              <div className="text-green-600 flex items-center">
                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Sync has started
              </div>
            )}
            {syncMutation.isError && (
              <div className="text-red-600">
                Sync failed: {syncMutation.error?.message}
              </div>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-6 py-2 rounded-md font-medium transition-colors flex items-center"
          >
            {syncMutation.isPending ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Syncing...
              </>
            ) : (
              'Start Sync'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}