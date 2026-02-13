'use client';

import { useState } from 'react';

interface ErrorLog {
  id: string;
  timestamp: string;
  level: 'error' | 'warning' | 'info';
  source: string;
  message: string;
  details?: any;
  filingId?: string;
  resolved: boolean;
}

// Mock data - TODO: Replace with real API call
const mockErrorLogs: ErrorLog[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    level: 'error',
    source: 'DART API',
    message: 'API rate limit exceeded',
    details: { statusCode: 429, endpoint: '/api/list.json' },
    resolved: false,
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    level: 'warning',
    source: 'Document Parser',
    message: 'Failed to parse table section',
    filingId: 'filing-123',
    details: { section: 'financial-data', error: 'Invalid table structure' },
    resolved: true,
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    level: 'error',
    source: 'Database',
    message: 'Connection timeout',
    details: { timeout: 30000, host: 'postgres.internal' },
    resolved: true,
  },
];

export function ErrorLogsPanel() {
  const [logs] = useState<ErrorLog[]>(mockErrorLogs);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [resolvedFilter, setResolvedFilter] = useState<string>('');

  const filteredLogs = logs.filter(log => {
    if (levelFilter && log.level !== levelFilter) return false;
    if (resolvedFilter === 'resolved' && !log.resolved) return false;
    if (resolvedFilter === 'unresolved' && log.resolved) return false;
    return true;
  });

  const getLevelBadge = (level: ErrorLog['level']) => {
    const styles = {
      error: 'bg-red-100 text-red-800',
      warning: 'bg-yellow-100 text-yellow-800',
      info: 'bg-blue-100 text-blue-800',
    };
    const labels = {
      error: 'Error',
      warning: 'Warning',
      info: 'Info',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[level]}`}>
        {labels[level]}
      </span>
    );
  };

  const getLevelIcon = (level: ErrorLog['level']) => {
    switch (level) {
      case 'error':
        return (
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const unresolvedCount = logs.filter(log => !log.resolved).length;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-medium text-gray-900">Error Logs</h3>
            {unresolvedCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                {unresolvedCount} unresolved
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Levels</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select
              value={resolvedFilter}
              onChange={(e) => setResolvedFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="unresolved">Unresolved</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs List */}
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Logs</h3>
            <p className="text-gray-600">No logs match the selected criteria.</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className={`p-4 hover:bg-gray-50 ${!log.resolved ? 'bg-red-50' : ''}`}>
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getLevelIcon(log.level)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getLevelBadge(log.level)}
                      <span className="text-sm text-gray-500">{log.source}</span>
                      {log.resolved && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Resolved
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(log.timestamp).toLocaleString('en-US')}
                    </div>
                  </div>
                  <div className="text-sm text-gray-900 font-medium mb-2">
                    {log.message}
                  </div>
                  {log.filingId && (
                    <div className="text-sm text-gray-600 mb-2">
                      Related Filing: {log.filingId}
                    </div>
                  )}
                  {log.details && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                        View Details
                      </summary>
                      <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {!log.resolved && (
                    <button
                      onClick={() => {
                        // TODO: Mark as resolved
                        console.log('Mark as resolved:', log.id);
                      }}
                      className="text-green-600 hover:text-green-800 text-sm font-medium"
                    >
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Total {filteredLogs.length} logs ({unresolvedCount} unresolved)
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => {
                // TODO: Export logs
                console.log('Export logs');
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Export Logs
            </button>
            <button
              onClick={() => {
                // TODO: Clear resolved logs
                console.log('Clear resolved logs');
              }}
              className="text-sm text-gray-600 hover:text-gray-800 font-medium"
            >
              Clear Resolved Logs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}