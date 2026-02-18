/**
 * Document Routes - Metadata and OCR bounding box endpoints
 *
 * Provides:
 * - POST /documents/:id/broken-pages  — update broken page list after ETL
 * - GET  /documents/:docId/metadata   — page count + broken pages for frontend
 * - GET  /documents/:docId/pages/:pageNum/ocr-bboxes — word-level OCR bbox JSON
 */

import { FastifyInstance } from 'fastify';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { prisma } from '../lib/database';
import { env } from '../config/environment';

const EXTRACTION_BUCKET = 'filing-extractions-128638789653';

const isPlaceholder = (val?: string) =>
  !val || val.includes('REPLACE') || val.includes('dev_') || val.length < 10;

const getS3Client = () => {
  if (!isPlaceholder(env.AWS_ACCESS_KEY_ID) && !isPlaceholder(env.AWS_SECRET_ACCESS_KEY)) {
    return new S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
      endpoint: env.S3_ENDPOINT || undefined,
    });
  }
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
  });
};

/** Parse "HKEX:12345" or just "12345" into { exchange, sourceId } */
function parseDocId(docId: string): { exchange: string; sourceId: string } {
  if (docId.includes(':')) {
    const [exchange, sourceId] = docId.split(':');
    return { exchange, sourceId };
  }
  return { exchange: 'DART', sourceId: docId };
}

export default async function documentRoutes(fastify: FastifyInstance) {
  // ── POST /documents/:id/broken-pages ─────────────────────────────────
  // Called by the ETL pipeline after processing to record which pages need OCR
  fastify.post<{
    Params: { id: string };
    Body: { broken_pages: number[] };
  }>('/documents/:id/broken-pages', {
    schema: {
      description: 'Update broken pages list for a filing',
      tags: ['documents'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          broken_pages: {
            type: 'array',
            items: { type: 'integer' },
          },
        },
        required: ['broken_pages'],
      },
    },
  }, async (request, reply) => {
    try {
      const { exchange, sourceId } = parseDocId(request.params.id);
      const { broken_pages } = request.body;

      await prisma.$executeRaw`
        UPDATE filings
        SET broken_pages = ${broken_pages}
        WHERE exchange = ${exchange} AND source_id = ${sourceId}
      `;

      return { success: true, data: { exchange, sourceId, broken_pages } };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update broken pages' },
      });
    }
  });

  // ── GET /documents/:docId/metadata ───────────────────────────────────
  // Returns page count and broken page numbers for the frontend viewer
  fastify.get<{
    Params: { docId: string };
  }>('/documents/:docId/metadata', {
    schema: {
      description: 'Get document metadata including broken pages',
      tags: ['documents'],
      params: {
        type: 'object',
        properties: { docId: { type: 'string' } },
        required: ['docId'],
      },
    },
  }, async (request, reply) => {
    try {
      const { exchange, sourceId } = parseDocId(request.params.docId);

      const rows = await prisma.$queryRaw<Array<{
        source_id: string;
        exchange: string;
        page_count: number | null;
        broken_pages: number[];
      }>>`
        SELECT source_id, exchange, page_count, broken_pages
        FROM filings
        WHERE exchange = ${exchange} AND source_id = ${sourceId}
        LIMIT 1
      `;

      if (rows.length === 0) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Document not found' },
        });
      }

      const row = rows[0];
      return {
        success: true,
        data: {
          doc_id: `${row.exchange}:${row.source_id}`,
          total_pages: row.page_count ?? 0,
          broken_pages: row.broken_pages ?? [],
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch document metadata' },
      });
    }
  });

  // ── GET /documents/:docId/pages/:pageNum/ocr-bboxes ──────────────────
  // Proxies the OCR word-level bounding box JSON from S3
  fastify.get<{
    Params: { docId: string; pageNum: string };
  }>('/documents/:docId/pages/:pageNum/ocr-bboxes', {
    schema: {
      description: 'Get OCR word-level bounding boxes for a page',
      tags: ['documents'],
      params: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          pageNum: { type: 'string' },
        },
        required: ['docId', 'pageNum'],
      },
    },
  }, async (request, reply) => {
    try {
      const { exchange, sourceId } = parseDocId(request.params.docId);
      const pageNum = parseInt(request.params.pageNum, 10);

      if (isNaN(pageNum) || pageNum < 1) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAGE', message: 'Page number must be a positive integer' },
        });
      }

      const s3Key = `ocr-bboxes/${exchange.toLowerCase()}/${sourceId}/page_${pageNum}.json`;

      const s3Client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: EXTRACTION_BUCKET,
        Key: s3Key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'OCR bboxes not found for this page' },
        });
      }

      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'public, max-age=86400'); // 24h cache

      const stream = response.Body as Readable;
      return reply.send(stream);
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'OCR bboxes not found for this page' },
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: { code: 'S3_ERROR', message: 'Failed to retrieve OCR bboxes' },
      });
    }
  });
}
