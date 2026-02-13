/**
 * Enhanced Filing Routes - Simplified for dartscrape schema
 *
 * Document sections/attachments not available until those tables are created.
 */

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/database';

export default async function enhancedFilingRoutes(fastify: FastifyInstance) {
  // Get document structure for viewer
  fastify.get<{ Params: { id: string } }>(
    '/filings/:id/document',
    {
      schema: {
        description: 'Get document structure for viewer',
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
        const [exchange, source_id] = id.includes(':') ? id.split(':') : ['DART', id];

        const filings = await prisma.$queryRaw<Array<{
          source_id: string;
          exchange: string;
          title: string | null;
          pdf_s3_key: string | null;
          source_url: string | null;
          page_count: number | null;
        }>>`
          SELECT source_id, exchange, title, pdf_s3_key, source_url, page_count
          FROM filings
          WHERE exchange = ${exchange} AND source_id = ${source_id}
          LIMIT 1
        `;

        if (filings.length === 0) {
          return reply.status(404).send({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Filing not found' },
          });
        }

        const f = filings[0];
        return {
          success: true,
          data: {
            id: `${f.exchange}:${f.source_id}`,
            title: f.title,
            pdfS3Key: f.pdf_s3_key,
            sourceUrl: f.source_url,
            pageCount: f.page_count,
            sections: [], // Not available in current schema
            attachments: [], // Not available in current schema
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch document' },
        });
      }
    }
  );

  // Get tables for a filing
  fastify.get<{ Params: { id: string } }>(
    '/filings/:id/tables',
    {
      schema: {
        description: 'Get extracted tables for a filing',
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
        const [_exchange, source_id] = id.includes(':') ? id.split(':') : ['DART', id];

        // Query extracted_tables by rcept_no (source_id)
        const tables = await prisma.$queryRaw<Array<{
          id: bigint;
          rcept_no: string;
          page_number: number;
          table_index: number;
          table_data: unknown;
          bbox_x0: number | null;
          bbox_y0: number | null;
          bbox_x1: number | null;
          bbox_y1: number | null;
          created_at: Date | null;
        }>>`
          SELECT id, rcept_no, page_number, table_index, table_data,
                 bbox_x0, bbox_y0, bbox_x1, bbox_y1, created_at
          FROM extracted_tables
          WHERE rcept_no = ${source_id}
          ORDER BY page_number, table_index
        `;

        const mappedTables = tables.map(t => ({
          id: t.id.toString(),
          rcptNo: t.rcept_no,
          pageNumber: t.page_number,
          tableIndex: t.table_index,
          tableData: t.table_data,
          position: t.bbox_x0 !== null ? {
            x: t.bbox_x0,
            y: t.bbox_y0,
            width: (t.bbox_x1 || 0) - (t.bbox_x0 || 0),
            height: (t.bbox_y1 || 0) - (t.bbox_y0 || 0),
          } : null,
          createdAt: t.created_at,
        }));

        return {
          success: true,
          data: mappedTables,
          meta: { total: tables.length },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tables' },
        });
      }
    }
  );

  // Get images/attachments - stub (not available in current schema)
  fastify.get<{ Params: { id: string } }>(
    '/filings/:id/images',
    async (_request, reply) => {
      return reply.status(200).send({
        success: true,
        data: [],
        meta: { total: 0, message: 'Image attachments not available in current schema' },
      });
    }
  );

  // Export filing - stub
  fastify.get<{ Params: { id: string } }>(
    '/filings/:id/export',
    async (request, reply) => {
      const { id } = request.params;
      const [exchange, source_id] = id.includes(':') ? id.split(':') : ['DART', id];

      const filings = await prisma.$queryRaw<Array<{
        source_url: string | null;
      }>>`
        SELECT source_url FROM filings
        WHERE exchange = ${exchange} AND source_id = ${source_id}
        LIMIT 1
      `;

      if (filings.length === 0 || !filings[0].source_url) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Filing not found' },
        });
      }

      // Redirect to source URL
      return reply.redirect(filings[0].source_url);
    }
  );
}
