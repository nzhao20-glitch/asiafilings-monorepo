/**
 * Search Routes - Simplified for dartscrape schema
 *
 * Full-text search on filings by title.
 * Document section search not available until those tables are created.
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/database';

interface SearchQuery {
  q: string;
  exchange?: string;
  limit?: number;
  page?: number;
}

export default async function searchRoutes(fastify: FastifyInstance) {
  // Search filings by title
  fastify.post<{ Body: { query: string; options?: { exchange?: string; page?: number; limit?: number } } }>(
    '/search',
    {
      schema: {
        description: 'Search filings by title',
        tags: ['search'],
        body: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            options: {
              type: 'object',
              properties: {
                exchange: { type: 'string' },
                page: { type: 'number' },
                limit: { type: 'number' },
              },
            },
          },
          required: ['query'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { query, options = {} } = request.body;
        const { exchange, page = 1, limit = 20 } = options;
        const skip = (page - 1) * limit;

        if (!query || query.trim().length === 0) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_QUERY', message: 'Search query is required' },
          });
        }

        // Build where clause
        const conditions: string[] = [`(title ILIKE $1 OR title_en ILIKE $1)`];
        const params: unknown[] = [`%${query}%`];
        let paramIndex = 2;

        if (exchange) {
          conditions.push(`exchange = $${paramIndex++}`);
          params.push(exchange);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        // Search filings
        const results = await prisma.$queryRawUnsafe<Array<{
          source_id: string;
          exchange: string;
          title: string | null;
          title_en: string | null;
          filing_type: string | null;
          report_date: Date | null;
          pdf_s3_key: string | null;
          company_id: string | null;
          company_name: string | null;
        }>>(
          `SELECT f.source_id, f.exchange, f.title, f.title_en, f.filing_type,
                  f.report_date, f.pdf_s3_key, f.company_id, c.name as company_name
           FROM filings f
           LEFT JOIN companies c ON f.company_id = c.company_id AND f.exchange = c.exchange
           ${whereClause}
           ORDER BY f.report_date DESC NULLS LAST
           LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
          ...params, limit, skip
        );

        // Get total count
        const countResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM filings f ${whereClause}`,
          ...params
        );
        const total = Number(countResult[0]?.count || 0);

        const mappedResults = results.map(r => ({
          id: `${r.exchange}:${r.source_id}`,
          sourceId: r.source_id,
          exchange: r.exchange,
          title: r.title,
          titleEn: r.title_en,
          filingType: r.filing_type,
          reportDate: r.report_date,
          pdfS3Key: r.pdf_s3_key,
          companyId: r.company_id,
          companyName: r.company_name,
          // Highlight matched text (simple approach)
          highlight: r.title?.includes(query) ? r.title : r.title_en,
        }));

        return {
          success: true,
          data: mappedResults,
          meta: {
            query,
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
          error: { code: 'INTERNAL_ERROR', message: 'Search failed' },
        });
      }
    }
  );

  // Search suggestions
  fastify.get<{ Querystring: SearchQuery }>(
    '/search/suggestions',
    {
      schema: {
        description: 'Get search suggestions',
        tags: ['search'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            exchange: { type: 'string' },
            limit: { type: 'number', default: 10 },
          },
          required: ['q'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { q, exchange, limit = 10 } = request.query;

        if (!q || q.trim().length < 2) {
          return { success: true, data: [] };
        }

        // Get distinct filing types and titles that match
        const conditions: string[] = [`title ILIKE $1`];
        const params: unknown[] = [`%${q}%`];
        let paramIndex = 2;

        if (exchange) {
          conditions.push(`exchange = $${paramIndex++}`);
          params.push(exchange);
        }

        const suggestions = await prisma.$queryRawUnsafe<Array<{ title: string }>>(
          `SELECT DISTINCT title FROM filings
           WHERE ${conditions.join(' AND ')} AND title IS NOT NULL
           LIMIT $${paramIndex}`,
          ...params, limit
        );

        return {
          success: true,
          data: suggestions.map(s => s.title),
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to get suggestions' },
        });
      }
    }
  );
}
