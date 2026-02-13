/**
 * Company Routes - Simplified for dartscrape schema
 * Uses in-memory trie for fast autocomplete search
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/database';
import { companySearchService } from '../lib/companyTrie';

interface CompanyListQuery {
  page?: number;
  limit?: number;
  search?: string;
  exchange?: string;
}

export default async function companyRoutes(fastify: FastifyInstance) {
  // Initialize trie in background (non-blocking) after server starts
  setTimeout(() => {
    companySearchService.load().catch(err => {
      fastify.log.error('Failed to initialize company trie:', err);
    });
  }, 5000); // Delay 5 seconds to let server fully start

  // List companies (no auth required for now)
  fastify.get<{ Querystring: CompanyListQuery }>(
    '/companies',
    {
      schema: {
        description: 'List companies with pagination',
        tags: ['companies'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            limit: { type: 'number', default: 20 },
            search: { type: 'string' },
            exchange: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { page = 1, limit = 20, search, exchange } = request.query;

        // Try trie for search queries (fast autocomplete)
        if (search && search.trim()) {
          const startTime = Date.now();
          const results = companySearchService.search(search, exchange, limit);

          // If trie is loaded and returns results, use them
          if (results !== null) {
            const elapsed = Date.now() - startTime;
            fastify.log.info(`Trie search for "${search}" returned ${results.length} results in ${elapsed}ms`);

            return {
              success: true,
              data: results.map(c => ({
                id: c.id,
                stockCode: c.stockCode,
                companyName: c.name,
                exchange: c.exchange,
              })),
              meta: {
                page: 1,
                limit,
                total: results.length,
                totalPages: 1,
                searchTime: elapsed,
              },
            };
          }
          // If trie not loaded, fall through to database query
          fastify.log.info(`Trie not loaded, falling back to database for "${search}"`);
        }

        // Fall back to database query
        const skip = (page - 1) * limit;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (exchange) {
          conditions.push(`exchange = $${paramIndex++}`);
          params.push(exchange);
        }

        if (search && search.trim()) {
          conditions.push(`(name ILIKE $${paramIndex} OR stock_code ILIKE $${paramIndex})`);
          params.push(`%${search}%`);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderClause = search
          ? `ORDER BY
              CASE
                WHEN stock_code = '${search.replace(/'/g, "''")}' THEN 0
                WHEN LOWER(name) = LOWER('${search.replace(/'/g, "''")}') THEN 1
                WHEN stock_code ILIKE '${search.replace(/'/g, "''")}%' THEN 2
                WHEN LOWER(name) ILIKE LOWER('${search.replace(/'/g, "''")}%') THEN 3
                WHEN stock_code IS NOT NULL AND stock_code != '' THEN 4
                ELSE 5
              END, name ASC`
          : `ORDER BY (CASE WHEN stock_code IS NOT NULL AND stock_code != '' AND stock_code != ' ' THEN 0 ELSE 1 END), name ASC`;

        const companies = await prisma.$queryRawUnsafe<Array<{
          company_id: string;
          name: string;
          stock_code: string | null;
          exchange: string;
          updated_at: Date;
        }>>(
          `SELECT company_id, name, stock_code, exchange, updated_at
           FROM companies ${whereClause}
           ${orderClause}
           LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
          ...params, limit, skip
        );

        const countResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM companies ${whereClause}`,
          ...params
        );
        const total = Number(countResult[0]?.count || 0);

        return {
          success: true,
          data: companies.map(c => ({
            id: `${c.exchange}:${c.company_id}`,
            stockCode: c.stock_code,
            companyName: c.name,
            exchange: c.exchange,
            updatedAt: c.updated_at,
          })),
          meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch companies',
          },
        });
      }
    }
  );

  // Get company by ID (exchange:company_id format)
  fastify.get<{ Params: { id: string } }>(
    '/companies/:id',
    {
      schema: {
        description: 'Get company by ID',
        tags: ['companies'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Parse composite ID (exchange:company_id)
        const [exchange, company_id] = id.includes(':') ? id.split(':') : ['DART', id];

        const companies = await prisma.$queryRaw<Array<{
          company_id: string;
          name: string;
          stock_code: string | null;
          exchange: string;
          updated_at: Date;
        }>>`
          SELECT company_id, name, stock_code, exchange, updated_at
          FROM companies
          WHERE exchange = ${exchange} AND company_id = ${company_id}
          LIMIT 1
        `;

        if (companies.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Company not found',
            },
          });
        }

        const company = companies[0];
        return {
          success: true,
          data: {
            id: `${company.exchange}:${company.company_id}`,
            stockCode: company.stock_code,
            companyName: company.name,
            exchange: company.exchange,
            updatedAt: company.updated_at,
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch company',
          },
        });
      }
    }
  );

  // Get company by stock code
  fastify.get<{ Params: { stockCode: string }; Querystring: { exchange?: string } }>(
    '/companies/by-stock-code/:stockCode',
    {
      schema: {
        description: 'Get company by stock code with recent filings',
        tags: ['companies'],
        params: {
          type: 'object',
          properties: {
            stockCode: { type: 'string' },
          },
          required: ['stockCode'],
        },
        querystring: {
          type: 'object',
          properties: {
            exchange: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { stockCode } = request.params;
        const { exchange } = request.query;

        let query = `SELECT company_id, name, stock_code, exchange, updated_at
                     FROM companies WHERE stock_code = $1`;
        const params: string[] = [stockCode];

        if (exchange) {
          query += ` AND exchange = $2`;
          params.push(exchange);
        }
        query += ` LIMIT 1`;

        const companies = await prisma.$queryRawUnsafe<Array<{
          company_id: string;
          name: string;
          stock_code: string | null;
          exchange: string;
          updated_at: Date;
        }>>(query, ...params);

        if (companies.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Company not found',
            },
          });
        }

        const company = companies[0];

        // Fetch all filings for this company (no limit - company pages should show all)
        const filings = await prisma.$queryRaw<Array<{
          source_id: string;
          exchange: string;
          title: string;
          title_en: string | null;
          filing_type: string | null;
          report_date: Date | null;
          source_url: string | null;
          processing_status: string | null;
        }>>`
          SELECT source_id, exchange, title, title_en, filing_type, report_date, source_url, processing_status
          FROM filings
          WHERE company_id = ${company.company_id} AND exchange = ${company.exchange}
          ORDER BY report_date DESC
        `;

        // Map filings to expected format
        // For DART filings, source_id IS the rcpNo, so we can construct the URL
        const recentFilings = filings.map(f => {
          const rcpNo = f.source_id;
          // Construct DART URL if source_url is empty
          const dartUrl = f.source_url || (f.exchange === 'DART' ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}` : null);

          return {
            id: `${f.exchange}:${f.source_id}`,
            rcpNo, // Include rcpNo directly for frontend navigation
            title: f.title || f.title_en || 'Untitled',
            filingType: f.filing_type || 'Other',
            reportDate: f.report_date?.toISOString() || null,
            sourceUrl: dartUrl,
            dartUrl, // Legacy support
            metadata: {
              processingStatus: f.processing_status || 'PENDING',
            },
          };
        });

        return {
          success: true,
          data: {
            company: {
              id: `${company.exchange}:${company.company_id}`,
              stockCode: company.stock_code,
              companyName: company.name,
              exchange: company.exchange,
              updatedAt: company.updated_at,
              recentFilings,
            },
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch company',
          },
        });
      }
    }
  );

  // Health check with trie status
  fastify.get('/companies-health', async () => {
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM companies`;
    const trieStatus = companySearchService.getStatus();
    return {
      status: 'ok',
      companyCount: Number(result[0]?.count || 0),
      trie: trieStatus,
    };
  });

  // Manual trie refresh endpoint (useful after data imports)
  fastify.post('/companies/refresh-search', async (_request, reply) => {
    try {
      const startTime = Date.now();
      await companySearchService.refresh();
      const elapsed = Date.now() - startTime;

      const status = companySearchService.getStatus();
      return {
        success: true,
        message: `Refreshed search index with ${status.companyCount} companies in ${elapsed}ms`,
        trie: status,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to refresh search index',
        },
      });
    }
  });
}
