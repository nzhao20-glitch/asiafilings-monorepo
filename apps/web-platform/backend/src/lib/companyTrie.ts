/**
 * Trie-based Company Search for fast autocomplete
 *
 * Provides O(m) prefix lookup where m = query length
 * Memory usage: ~20-30MB for 120k companies
 */

import { prisma } from './database';

interface CompanyData {
  id: string;
  companyId: string;
  name: string;
  stockCode: string | null;
  exchange: string;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  companies: CompanyData[];  // Companies that match at this node
}

class Trie {
  private root: TrieNode;

  constructor() {
    this.root = this.createNode();
  }

  private createNode(): TrieNode {
    return {
      children: new Map(),
      companies: [],
    };
  }

  /**
   * Insert a company into the trie, indexed by a key (name or stock code)
   */
  insert(key: string, company: CompanyData): void {
    const normalizedKey = key.toLowerCase().trim();
    if (!normalizedKey) return;

    let node = this.root;
    for (const char of normalizedKey) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createNode());
      }
      node = node.children.get(char)!;
    }

    // Avoid duplicates at the same node
    if (!node.companies.some(c => c.id === company.id)) {
      node.companies.push(company);
    }
  }

  /**
   * Search for companies matching a prefix
   * Returns companies sorted by relevance (exact match first, then by name)
   */
  search(prefix: string, limit: number = 10): CompanyData[] {
    const normalizedPrefix = prefix.toLowerCase().trim();
    if (!normalizedPrefix) return [];

    // Navigate to the prefix node
    let node = this.root;
    for (const char of normalizedPrefix) {
      if (!node.children.has(char)) {
        return []; // No matches
      }
      node = node.children.get(char)!;
    }

    // Collect all companies under this prefix
    const results: CompanyData[] = [];
    this.collectCompanies(node, results, limit * 3); // Collect extra for sorting

    // Sort by relevance:
    // 1. Exact stock code match
    // 2. Exact name match
    // 3. Stock code starts with prefix
    // 4. Name starts with prefix
    // 5. Has stock code (publicly traded)
    // 6. Alphabetically by name
    results.sort((a, b) => {
      const aStockLower = (a.stockCode || '').toLowerCase();
      const bStockLower = (b.stockCode || '').toLowerCase();
      const aNameLower = a.name.toLowerCase();
      const bNameLower = b.name.toLowerCase();

      // Exact stock code match
      if (aStockLower === normalizedPrefix && bStockLower !== normalizedPrefix) return -1;
      if (bStockLower === normalizedPrefix && aStockLower !== normalizedPrefix) return 1;

      // Exact name match
      if (aNameLower === normalizedPrefix && bNameLower !== normalizedPrefix) return -1;
      if (bNameLower === normalizedPrefix && aNameLower !== normalizedPrefix) return 1;

      // Stock code starts with prefix
      const aStockStarts = aStockLower.startsWith(normalizedPrefix);
      const bStockStarts = bStockLower.startsWith(normalizedPrefix);
      if (aStockStarts && !bStockStarts) return -1;
      if (bStockStarts && !aStockStarts) return 1;

      // Has stock code (publicly traded companies first)
      const aHasStock = a.stockCode && a.stockCode.trim() !== '';
      const bHasStock = b.stockCode && b.stockCode.trim() !== '';
      if (aHasStock && !bHasStock) return -1;
      if (bHasStock && !aHasStock) return 1;

      // Alphabetically by name
      return a.name.localeCompare(b.name);
    });

    // Deduplicate by id (same company might be indexed by name and stock code)
    const seen = new Set<string>();
    const deduplicated: CompanyData[] = [];
    for (const company of results) {
      if (!seen.has(company.id)) {
        seen.add(company.id);
        deduplicated.push(company);
        if (deduplicated.length >= limit) break;
      }
    }

    return deduplicated;
  }

  /**
   * Recursively collect companies from a node and all its descendants
   */
  private collectCompanies(node: TrieNode, results: CompanyData[], limit: number): void {
    // Add companies at this node
    for (const company of node.companies) {
      if (results.length >= limit) return;
      results.push(company);
    }

    // Recursively collect from children
    for (const child of node.children.values()) {
      if (results.length >= limit) return;
      this.collectCompanies(child, results, limit);
    }
  }

  /**
   * Clear the trie
   */
  clear(): void {
    this.root = this.createNode();
  }
}

/**
 * Company Search Service - manages the trie and provides search functionality
 */
class CompanySearchService {
  private trie: Trie;
  private isLoaded: boolean = false;
  private isLoading: boolean = false;
  private lastLoadTime: Date | null = null;
  private companyCount: number = 0;

  constructor() {
    this.trie = new Trie();
  }

  /**
   * Load all companies from database into the trie
   */
  async load(): Promise<void> {
    if (this.isLoading) {
      // Wait for existing load to complete
      while (this.isLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.isLoading = true;
    const startTime = Date.now();

    try {
      console.log('🔄 Loading companies into trie...');

      // Clear trie before loading
      this.trie.clear();

      // Load in batches to avoid OOM
      const BATCH_SIZE = 10000;
      let offset = 0;
      let totalLoaded = 0;

      while (true) {
        console.log(`🔄 Fetching batch at offset ${offset}...`);

        const batch = await prisma.$queryRaw<Array<{
          company_id: string;
          name: string;
          stock_code: string | null;
          exchange: string;
        }>>`
          SELECT company_id, name, stock_code, exchange
          FROM companies
          LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

        if (batch.length === 0) break;

        // Insert batch into trie
        for (const company of batch) {
          const companyData: CompanyData = {
            id: `${company.exchange}:${company.company_id}`,
            companyId: company.company_id,
            name: company.name,
            stockCode: company.stock_code,
            exchange: company.exchange,
          };

          // Index by company name
          this.trie.insert(company.name, companyData);

          // Index by stock code if exists
          if (company.stock_code && company.stock_code.trim()) {
            this.trie.insert(company.stock_code, companyData);
          }
        }

        totalLoaded += batch.length;
        offset += BATCH_SIZE;
        console.log(`🔄 Loaded ${totalLoaded} companies so far...`);

        // Small delay to allow GC between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.companyCount = totalLoaded;
      this.isLoaded = true;
      this.lastLoadTime = new Date();

      const elapsed = Date.now() - startTime;
      console.log(`✅ Loaded ${totalLoaded} companies into trie in ${elapsed}ms`);
    } catch (error) {
      console.error('❌ Failed to load companies into trie:', error);
      // Don't throw - let the server continue running without the trie
      // Searches will fall back to database queries
      this.isLoaded = false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Search for companies by prefix
   * Returns null if trie isn't loaded (caller should fall back to DB)
   */
  search(query: string, exchange?: string, limit: number = 10): CompanyData[] | null {
    // Return null if trie isn't loaded - caller should use database fallback
    if (!this.isLoaded) {
      return null;
    }

    let results = this.trie.search(query, limit * 2); // Get extra for filtering

    // Filter by exchange if specified
    if (exchange) {
      results = results.filter(c => c.exchange === exchange);
    }

    return results.slice(0, limit);
  }

  /**
   * Refresh the trie (call periodically or on data change)
   */
  async refresh(): Promise<void> {
    await this.load();
  }

  /**
   * Get service status
   */
  getStatus(): { isLoaded: boolean; companyCount: number; lastLoadTime: Date | null } {
    return {
      isLoaded: this.isLoaded,
      companyCount: this.companyCount,
      lastLoadTime: this.lastLoadTime,
    };
  }
}

// Singleton instance
export const companySearchService = new CompanySearchService();
