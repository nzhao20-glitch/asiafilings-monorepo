/**
 * Filing Routes - Simplified for dartscrape schema
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/database';

interface FilingListQuery {
  page?: number;
  limit?: number;
  companyId?: string;
  exchange?: string;
  filingType?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export default async function filingRoutes(fastify: FastifyInstance) {
  // List filings with filtering and pagination
  fastify.get<{ Querystring: FilingListQuery }>(
    '/filings',
    {
      schema: {
        description: 'List filings with pagination and filters',
        tags: ['filings'],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'number', default: 1 },
            limit: { type: 'number', default: 20 },
            companyId: { type: 'string' },
            exchange: { type: 'string' },
            filingType: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            search: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { page = 1, limit = 20, companyId, exchange, filingType, startDate, endDate, search } = request.query;
        const skip = (page - 1) * limit;

        // Build where clause
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (exchange) {
          conditions.push(`f.exchange = $${paramIndex++}`);
          params.push(exchange);
        }

        if (companyId) {
          conditions.push(`f.company_id = $${paramIndex++}`);
          params.push(companyId);
        }

        if (filingType) {
          conditions.push(`f.filing_type ILIKE $${paramIndex++}`);
          params.push(`%${filingType}%`);
        }

        if (startDate) {
          conditions.push(`f.report_date >= $${paramIndex++}`);
          params.push(startDate);
        }

        if (endDate) {
          conditions.push(`f.report_date <= $${paramIndex++}`);
          params.push(endDate);
        }

        if (search) {
          conditions.push(`(f.title ILIKE $${paramIndex} OR f.title_en ILIKE $${paramIndex})`);
          params.push(`%${search}%`);
          paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get filings with company info
        const filings = await prisma.$queryRawUnsafe<Array<{
          source_id: string;
          exchange: string;
          company_id: string | null;
          title: string | null;
          title_en: string | null;
          filing_type: string | null;
          report_date: Date | null;
          source_url: string | null;
          pdf_s3_key: string | null;
          page_count: number | null;
          file_size: number | null;
          processing_status: string | null;
          created_at: Date;
          company_name: string | null;
          stock_code: string | null;
        }>>(
          `SELECT f.source_id, f.exchange, f.company_id, f.title, f.title_en,
                  f.filing_type, f.report_date, f.source_url, f.pdf_s3_key,
                  f.page_count, f.file_size, f.processing_status, f.created_at,
                  c.name as company_name, c.stock_code
           FROM filings f
           LEFT JOIN companies c ON f.company_id = c.company_id AND f.exchange = c.exchange
           ${whereClause}
           ORDER BY f.report_date DESC NULLS LAST, f.created_at DESC
           LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
          ...params, limit, skip
        );

        // Get total count
        const countResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM filings f ${whereClause}`,
          ...params
        );
        const total = Number(countResult[0]?.count || 0);

        // Map to expected format
        const mappedFilings = filings.map(f => ({
          id: `${f.exchange}:${f.source_id}`,
          sourceId: f.source_id,
          exchange: f.exchange,
          companyId: f.company_id,
          title: f.title,
          titleEn: f.title_en,
          filingType: f.filing_type,
          reportDate: f.report_date,
          sourceUrl: f.source_url,
          pdfS3Key: f.pdf_s3_key,
          pageCount: f.page_count,
          fileSize: f.file_size,
          processingStatus: f.processing_status,
          createdAt: f.created_at,
          company: f.company_name ? {
            name: f.company_name,
            stockCode: f.stock_code,
          } : null,
        }));

        return {
          success: true,
          data: mappedFilings,
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
            message: 'Failed to fetch filings',
          },
        });
      }
    }
  );

  // Get filing by ID (exchange:source_id format)
  fastify.get<{ Params: { id: string } }>(
    '/filings/:id',
    {
      schema: {
        description: 'Get filing by ID',
        tags: ['filings'],
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

        // Parse composite ID (exchange:source_id)
        const [exchange, source_id] = id.includes(':') ? id.split(':') : ['DART', id];

        const filings = await prisma.$queryRaw<Array<{
          source_id: string;
          exchange: string;
          company_id: string | null;
          title: string | null;
          title_en: string | null;
          filing_type: string | null;
          report_date: Date | null;
          source_url: string | null;
          pdf_s3_key: string | null;
          page_count: number | null;
          file_size: number | null;
          processing_status: string | null;
          created_at: Date;
          company_name: string | null;
          stock_code: string | null;
        }>>`
          SELECT f.source_id, f.exchange, f.company_id, f.title, f.title_en,
                 f.filing_type, f.report_date, f.source_url, f.pdf_s3_key,
                 f.page_count, f.file_size, f.processing_status, f.created_at,
                 c.name as company_name, c.stock_code
          FROM filings f
          LEFT JOIN companies c ON f.company_id = c.company_id AND f.exchange = c.exchange
          WHERE f.exchange = ${exchange} AND f.source_id = ${source_id}
          LIMIT 1
        `;

        if (filings.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Filing not found',
            },
          });
        }

        const f = filings[0];
        return {
          success: true,
          data: {
            id: `${f.exchange}:${f.source_id}`,
            sourceId: f.source_id,
            exchange: f.exchange,
            companyId: f.company_id,
            title: f.title,
            titleEn: f.title_en,
            filingType: f.filing_type,
            reportDate: f.report_date,
            sourceUrl: f.source_url,
            pdfS3Key: f.pdf_s3_key,
            pageCount: f.page_count,
            fileSize: f.file_size,
            processingStatus: f.processing_status,
            createdAt: f.created_at,
            company: f.company_name ? {
              name: f.company_name,
              stockCode: f.stock_code,
            } : null,
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch filing',
          },
        });
      }
    }
  );

  // Get filing by rcpNo/sourceId (works for both DART and HKEX)
  fastify.get<{ Params: { rcpNo: string } }>(
    '/filings/by-rcp-no/:rcpNo',
    {
      schema: {
        description: 'Get filing by source ID (rcpNo for DART, numeric ID for HKEX)',
        tags: ['filings'],
        params: {
          type: 'object',
          properties: {
            rcpNo: { type: 'string' },
          },
          required: ['rcpNo'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { rcpNo } = request.params;

        // Get filing with company info
        const filings = await prisma.$queryRaw<Array<{
          source_id: string;
          exchange: string;
          company_id: string | null;
          title: string | null;
          title_en: string | null;
          filing_type: string | null;
          report_date: Date | null;
          pdf_s3_key: string | null;
          source_url: string | null;
          processing_status: string | null;
          language: string | null;
          created_at: Date;
          updated_at: Date | null;
        }>>`
          SELECT source_id, exchange, company_id, title, title_en, filing_type,
                 report_date, pdf_s3_key, source_url, processing_status, language,
                 created_at, updated_at
          FROM filings
          WHERE source_id = ${rcpNo}
          LIMIT 1
        `;

        if (filings.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Filing not found',
            },
          });
        }

        const f = filings[0];

        // Fetch company info if company_id exists
        let company = null;
        if (f.company_id) {
          const companies = await prisma.$queryRaw<Array<{
            company_id: string;
            name: string;
            stock_code: string | null;
            exchange: string;
          }>>`
            SELECT company_id, name, stock_code, exchange
            FROM companies
            WHERE company_id = ${f.company_id} AND exchange = ${f.exchange}
            LIMIT 1
          `;
          if (companies.length > 0) {
            const c = companies[0];
            company = {
              id: `${c.exchange}:${c.company_id}`,
              stockCode: c.stock_code,
              companyName: c.name,
              exchange: c.exchange,
            };
          }
        }

        // Construct source URL if missing
        let sourceUrl = f.source_url;
        if (!sourceUrl && f.exchange === 'DART') {
          sourceUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${f.source_id}`;
        }

        return {
          success: true,
          data: {
            id: `${f.exchange}:${f.source_id}`,
            sourceId: f.source_id,
            exchange: f.exchange,
            companyId: f.company_id,
            title: f.title || f.title_en || 'Untitled',
            filingType: f.filing_type || 'Other',
            reportDate: f.report_date,
            pdfS3Key: f.pdf_s3_key,
            sourceUrl,
            processingStatus: f.processing_status || 'PENDING',
            language: f.language || 'KO',
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            company,
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to fetch filing',
          },
        });
      }
    }
  );

  // Health check
  fastify.get('/filings-health', async () => {
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM filings`;
    return { status: 'ok', filingCount: Number(result[0]?.count || 0) };
  });
}
