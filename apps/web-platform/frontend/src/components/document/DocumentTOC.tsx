'use client';

import { useState, useEffect } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface OutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  color?: number[];
  dest: any;
  url?: string | null;
  unsafeUrl?: string;
  newWindow?: boolean;
  count?: number;
  items?: OutlineItem[];
}

interface DocumentTOCProps {
  outline: OutlineItem[];
  onNavigate: (dest: any) => void;
  currentPage?: number;
}

export function DocumentTOC({ outline, onNavigate, currentPage }: DocumentTOCProps) {
  if (!outline || outline.length === 0) {
    return (
      <div className="h-full bg-gray-50 border-r border-gray-200 flex items-center justify-center p-4">
        <p className="text-sm text-gray-500 text-center">No table of contents</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-bold text-gray-900">Table of Contents</h2>
      </div>

      {/* TOC Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <OutlineTree items={outline} onNavigate={onNavigate} level={0} currentPage={currentPage} />
      </div>
    </div>
  );
}

interface OutlineTreeProps {
  items: OutlineItem[];
  onNavigate: (dest: any) => void;
  level: number;
  currentPage?: number;
}

function OutlineTree({ items, onNavigate, level, currentPage }: OutlineTreeProps) {
  return (
    <div className={level > 0 ? 'ml-4' : ''}>
      {items.map((item, index) => (
        <OutlineNode
          key={`${level}-${index}`}
          item={item}
          onNavigate={onNavigate}
          level={level}
          currentPage={currentPage}
        />
      ))}
    </div>
  );
}

interface OutlineNodeProps {
  item: OutlineItem;
  onNavigate: (dest: any) => void;
  level: number;
  currentPage?: number;
}

function OutlineNode({ item, onNavigate, level, currentPage }: OutlineNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0); // Top level expanded by default
  const hasChildren = item.items && item.items.length > 0;

  const handleClick = () => {
    if (item.dest) {
      onNavigate(item.dest);
    }
    // If has children, also toggle expansion
    if (hasChildren) {
      setIsExpanded(!isExpanded);
    }
  };

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="select-none">
      <div
        className={`
          flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors
          ${level === 0 ? 'font-semibold text-sm' : level === 1 ? 'font-medium text-xs' : 'text-xs'}
          ${item.bold ? 'font-bold' : ''}
          ${item.italic ? 'italic' : ''}
          hover:bg-blue-100 hover:text-blue-700
        `}
        onClick={handleClick}
      >
        {/* Expand/Collapse Icon */}
        {hasChildren ? (
          <button
            onClick={toggleExpand}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-gray-500 hover:text-blue-600"
          >
            {isExpanded ? (
              <ChevronDownIcon className="w-3 h-3" />
            ) : (
              <ChevronRightIcon className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* Title */}
        <span className="flex-1 truncate text-gray-700 korean-text">
          {item.title}
        </span>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <OutlineTree
          items={item.items!}
          onNavigate={onNavigate}
          level={level + 1}
          currentPage={currentPage}
        />
      )}
    </div>
  );
}
