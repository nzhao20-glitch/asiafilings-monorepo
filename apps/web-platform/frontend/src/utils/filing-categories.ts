export type FilingCategory = 'financials' | 'news' | 'ownership' | 'proxies' | 'prospectuses' | 'related_party' | 'other';

export const categoryConfig: Record<FilingCategory, { name: string; icon: string }> = {
  financials: { name: 'Financial Reports', icon: '📊' },
  news: { name: 'News & Announcements', icon: '📰' },
  ownership: { name: 'Ownership Changes', icon: '👥' },
  proxies: { name: 'Proxy Statements', icon: '📋' },
  prospectuses: { name: 'Prospectuses', icon: '📘' },
  related_party: { name: 'Related Party Transactions', icon: '🔗' },
  other: { name: 'Other', icon: '📄' },
};

export const categoryOrder: FilingCategory[] = [
  'financials', 'news', 'ownership', 'proxies', 'prospectuses', 'related_party', 'other',
];

export function categorizeFilingType(filingType: string, title?: string): FilingCategory {
  const type = filingType.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  if (type.includes('사업보고서') || type.includes('annual') ||
      type.includes('반기보고서') || type.includes('quarterly') ||
      type.includes('분기보고서') || type.includes('감사보고서') ||
      type.includes('financial statements') || type.includes('financial report') ||
      type.includes('interim report') || type.includes('esg information')) {
    return 'financials';
  }

  if (type.includes('공시') || type.includes('공고') || type.includes('보도자료') ||
      type.includes('announcements') || type.includes('notices') ||
      type.includes('press release') || type.includes('news')) {
    return 'news';
  }

  if (type.includes('지분') || type.includes('소유') || type.includes('주식') ||
      type.includes('ownership') || type.includes('주요주주') ||
      type.includes('monthly return') || type.includes('disclosure return') ||
      type.includes('securities') || titleLower.includes('movements in securities')) {
    return 'ownership';
  }

  if (type.includes('위임') || type.includes('proxy') ||
      type.includes('circular')) {
    return 'proxies';
  }

  if (type.includes('투자설명서') || type.includes('증권신고서') || type.includes('prospectus') ||
      type.includes('listing document') || type.includes('offering')) {
    return 'prospectuses';
  }

  if (type.includes('특수관계') || type.includes('내부거래') || type.includes('related party') ||
      titleLower.includes('connected transaction') || titleLower.includes('related party')) {
    return 'related_party';
  }

  return 'other';
}

export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
