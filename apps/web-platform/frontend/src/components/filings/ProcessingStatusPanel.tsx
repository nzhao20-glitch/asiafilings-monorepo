'use client';

import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';

interface ProcessingStatusPanelProps {
  className?: string;
}

export function ProcessingStatusPanel({ className = '' }: ProcessingStatusPanelProps) {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['processing-stats'],
    queryFn: () => apiService.getProcessingStats(),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (isLoading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
        <div className="animate-pulse">
          <div className="flex space-x-4">
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !stats?.data) {
    return (
      <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
        <div className="text-center text-gray-500">
          <p>처리 통계를 불러올 수 없습니다.</p>
        </div>
      </div>
    );
  }

  const processingStats = stats.data;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const completionRate = processingStats.total > 0
    ? Math.round((processingStats.completed / processingStats.total) * 100)
    : 0;

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">처리 현황</h3>
        <div className="text-sm text-gray-500">
          평균 처리 시간: {processingStats.avgProcessingTime}분
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{processingStats.total}</div>
          <div className="text-sm text-gray-500">총 파일링</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${getStatusColor('pending').split(' ')[0]}`}>
            {processingStats.pending}
          </div>
          <div className="text-sm text-gray-500">대기중</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${getStatusColor('processing').split(' ')[0]}`}>
            {processingStats.processing}
          </div>
          <div className="text-sm text-gray-500">처리중</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${getStatusColor('completed').split(' ')[0]}`}>
            {processingStats.completed}
          </div>
          <div className="text-sm text-gray-500">완료</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${getStatusColor('failed').split(' ')[0]}`}>
            {processingStats.failed}
          </div>
          <div className="text-sm text-gray-500">실패</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>전체 진행률</span>
          <span>{completionRate}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${completionRate}%` }}
          ></div>
        </div>
      </div>

      {/* Recent Activity */}
      {processingStats.recentlyCompleted > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">
                지난 24시간 동안 {processingStats.recentlyCompleted}개 파일링이 성공적으로 처리되었습니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Warning for Failed Files */}
      {processingStats.failed > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 mt-3">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 6.5c-.77.833-.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-red-800">
                {processingStats.failed}개 파일링 처리가 실패했습니다. 아래 목록에서 재시도할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}