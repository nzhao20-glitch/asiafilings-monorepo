/**
 * Tests for utility formatting functions
 */
import { describe, it, expect } from 'vitest';

// Example Korean text formatting utilities
function formatKoreanCompanyName(name: string): string {
  // Remove common suffixes and standardize
  return name
    .replace(/주식회사/g, '')
    .replace(/\(주\)/g, '')
    .trim();
}

function formatStockCode(code: string): string {
  // Ensure 6-digit format
  return code.padStart(6, '0');
}

function formatKoreanDate(dateStr: string): string {
  // Convert YYYYMMDD to Korean format YYYY년 MM월 DD일
  if (dateStr.length !== 8) return dateStr;
  
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  
  return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일`;
}

describe('Korean Formatters', () => {
  describe('formatKoreanCompanyName', () => {
    it('should remove 주식회사 suffix', () => {
      expect(formatKoreanCompanyName('삼성전자주식회사')).toBe('삼성전자');
      expect(formatKoreanCompanyName('현대자동차주식회사')).toBe('현대자동차');
    });

    it('should remove (주) suffix', () => {
      expect(formatKoreanCompanyName('카카오(주)')).toBe('카카오');
      expect(formatKoreanCompanyName('네이버(주)')).toBe('네이버');
    });

    it('should handle mixed Korean and English names', () => {
      expect(formatKoreanCompanyName('SK하이닉스주식회사')).toBe('SK하이닉스');
      expect(formatKoreanCompanyName('LG전자(주)')).toBe('LG전자');
    });
  });

  describe('formatStockCode', () => {
    it('should pad short codes with zeros', () => {
      expect(formatStockCode('5930')).toBe('005930');
      expect(formatStockCode('660')).toBe('000660');
    });

    it('should leave 6-digit codes unchanged', () => {
      expect(formatStockCode('005930')).toBe('005930');
      expect(formatStockCode('035420')).toBe('035420');
    });
  });

  describe('formatKoreanDate', () => {
    it('should format YYYYMMDD to Korean date format', () => {
      expect(formatKoreanDate('20240131')).toBe('2024년 1월 31일');
      expect(formatKoreanDate('20240315')).toBe('2024년 3월 15일');
    });

    it('should handle invalid date formats gracefully', () => {
      expect(formatKoreanDate('2024-01-31')).toBe('2024-01-31');
      expect(formatKoreanDate('invalid')).toBe('invalid');
    });

    it('should remove leading zeros from month and day', () => {
      expect(formatKoreanDate('20240101')).toBe('2024년 1월 1일');
      expect(formatKoreanDate('20241205')).toBe('2024년 12월 5일');
    });
  });
});