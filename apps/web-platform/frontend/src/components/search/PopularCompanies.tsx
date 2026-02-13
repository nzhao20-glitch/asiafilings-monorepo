'use client';

import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/src/services/api';

interface Company {
  id: string;
  name: string;
  stockCode: string;
  marketType: string;
}

interface PopularCompaniesProps {
  onCompanySelect: (company: Company) => void;
}

export function PopularCompanies({ onCompanySelect }: PopularCompaniesProps) {
  const { data: popularCompanies, isLoading } = useQuery({
    queryKey: ['popular-companies'],
    queryFn: () => apiService.getPopularCompanies(),
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const companies = popularCompanies?.data || [];

  // Fallback popular companies if API not implemented yet
  const fallbackCompanies: Company[] = [
    { id: '1', name: 'Samsung Electronics', stockCode: '005930', marketType: 'KOSPI' },
    { id: '2', name: 'SK Hynix', stockCode: '000660', marketType: 'KOSPI' },
    { id: '3', name: 'LG Energy Solution', stockCode: '373220', marketType: 'KOSPI' },
    { id: '4', name: 'Samsung Biologics', stockCode: '207940', marketType: 'KOSPI' },
    { id: '5', name: 'NAVER', stockCode: '035420', marketType: 'KOSPI' },
    { id: '6', name: 'Kakao', stockCode: '035720', marketType: 'KOSPI' },
    { id: '7', name: 'LG Chem', stockCode: '051910', marketType: 'KOSPI' },
    { id: '8', name: 'Hyundai Motor', stockCode: '005380', marketType: 'KOSPI' },
  ];

  const displayCompanies = companies.length > 0 ? companies : fallbackCompanies;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-900">Popular Stocks</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 rounded-lg h-16"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900">Popular Stocks</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {displayCompanies.map((company: Company) => (
          <button
            key={company.id}
            onClick={() => onCompanySelect(company)}
            className="group bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all duration-200 text-left"
          >
            <div className="space-y-1">
              <div className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                {company.name}
              </div>
              <div className="text-sm text-gray-500">
                {company.stockCode}
              </div>
              <div className="text-xs text-gray-400 bg-gray-50 group-hover:bg-blue-50 px-2 py-1 rounded inline-block">
                {company.marketType}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}