'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ManualSyncPanel } from '@/src/components/admin/ManualSyncPanel';
import { ErrorLogsPanel } from '@/src/components/admin/ErrorLogsPanel';
import { useRouter } from 'next/navigation';
import { apiService } from '@/src/services/api';

type AdminTab = 'sync' | 'jobs' | 'filings' | 'health' | 'logs';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('sync');
  const router = useRouter();

  const { data: healthData } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiService.getHealth(),
    refetchInterval: 30000,
  });

  const tabs = [
    { id: 'sync' as AdminTab, name: 'Sync Management', icon: '' },
    { id: 'jobs' as AdminTab, name: 'Job Status', icon: '' },
    { id: 'filings' as AdminTab, name: 'Filing Management', icon: '' },
    { id: 'health' as AdminTab, name: 'System Health', icon: '' },
    { id: 'logs' as AdminTab, name: 'Error Logs', icon: '' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Panel</h1>
          <p className="text-gray-600">
            DART API synchronization and system monitoring
          </p>

          {/* System Status Indicator */}
          <div className="mt-4 flex items-center space-x-4">
            <div className="flex items-center">
              <div
                className={`w-3 h-3 rounded-full mr-2 ${
                  healthData?.data?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                }`}
              ></div>
              <span className="text-sm text-gray-600">
                System Status: {healthData?.data?.status === 'healthy' ? 'Healthy' : 'Error'}
              </span>
            </div>
            <div className="text-sm text-gray-500">
              Last Updated: {new Date().toLocaleTimeString('en-US')}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.name}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === 'sync' && (
            <div className="space-y-6">
              <ManualSyncPanel />
            </div>
          )}

          {activeTab === 'jobs' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Job Status</h3>
                <p className="text-gray-600">
                  Sync job status panel (Coming soon)
                </p>
              </div>
            </div>
          )}

          {activeTab === 'filings' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Filing Management</h3>
                <p className="text-gray-600 mb-6">
                  Search filings, monitor processing status, and perform bulk management tasks.
                </p>
                <button
                  onClick={() => router.push('/admin/filings')}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md font-medium transition-colors inline-flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Open Filing Management
                </button>
              </div>
            </div>
          )}

          {activeTab === 'health' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">System Health</h3>
                <p className="text-gray-600">
                  System health monitoring panel (Coming soon)
                </p>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-6">
              <ErrorLogsPanel />
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => {
                // TODO: Implement emergency sync
              }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-md font-medium transition-colors"
            >
              Emergency Sync
            </button>
            <button
              onClick={() => {
                // TODO: Implement system health check
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-md font-medium transition-colors"
            >
              System Check
            </button>
            <button
              onClick={() => {
                // TODO: Implement clear error logs
              }}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded-md font-medium transition-colors"
            >
              Clear Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
