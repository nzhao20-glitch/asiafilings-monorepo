'use client';

import { useState, useRef, useEffect } from 'react';
import { useExchange, Exchange, EXCHANGE_CONFIG } from '@/src/contexts/ExchangeContext';
import KR from 'country-flag-icons/react/3x2/KR';
import HK from 'country-flag-icons/react/3x2/HK';

const FLAG_COMPONENTS: Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement>>> = { KR, HK };

interface ExchangeToggleProps {
  className?: string;
}

export function ExchangeToggle({ className = '' }: ExchangeToggleProps) {
  const { exchange, setExchange, config } = useExchange();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const exchanges: Exchange[] = ['DART', 'HKEX'];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (ex: Exchange) => {
    setExchange(ex);
    setIsOpen(false);
  };

  const FlagIcon = FLAG_COMPONENTS[config.countryCode];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-xl text-sm font-medium transition-all duration-200"
      >
        {FlagIcon && <FlagIcon className="w-5 h-4 rounded-sm" />}
        <span className="hidden sm:inline text-neutral-800">{config.displayName}</span>
        <svg
          className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-elevated border border-neutral-200 py-1 z-50">
          {exchanges.map((ex) => {
            const exConfig = EXCHANGE_CONFIG[ex];
            const isActive = exchange === ex;
            const ExFlag = FLAG_COMPONENTS[exConfig.countryCode];

            return (
              <button
                key={ex}
                onClick={() => handleSelect(ex)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {ExFlag && <ExFlag className="w-6 h-4 rounded-sm" />}
                <div className="flex-1">
                  <div className="font-medium">{exConfig.displayName}</div>
                  <div className="text-xs text-neutral-500">{exConfig.name}</div>
                </div>
                {isActive && (
                  <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
