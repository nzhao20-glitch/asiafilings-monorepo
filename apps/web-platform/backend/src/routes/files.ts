import { FastifyInstance } from 'fastify';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/environment';
import { Readable } from 'stream';

// Consolidated S3 bucket for all PDF documents (ap-east-1 Hong Kong)
// Structure: pdfs-128638789653/dart/... and pdfs-128638789653/hkex/...
const PDF_BUCKET = 'pdfs-128638789653';

// Valid prefixes for PDF documents
const VALID_PREFIXES = ['dart', 'hkex'];

// Get the appropriate bucket for an S3 key based on its prefix
const getBucketForKey = (s3Key: string): string | null => {
  const prefix = s3Key.split('/')[0]?.toLowerCase();

  // All dart/ and hkex/ files are in the consolidated PDF bucket
  if (prefix && VALID_PREFIXES.includes(prefix)) {
    return PDF_BUCKET;
  }

  return null;
};

// Initialize S3 client
// Uses explicit credentials if provided, otherwise falls back to default
// credential chain (IAM instance role, env vars, ~/.aws/credentials)
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

  // Default credential chain: IAM instance role → env vars → ~/.aws/credentials
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
  });
};

// Get content type based on file extension
const getContentType = (key: string): string => {
  const ext = key.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    'pdf': 'application/pdf',
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
    'xml': 'application/xml',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
};

export default async function filesRoutes(fastify: FastifyInstance) {
  // Get file from S3 - proxies content to avoid CORS issues
  // Route handles paths like /api/files/dart/00542898/2019/10/23/20191023000380.pdf
  fastify.get<{
    Params: { '*': string };
  }>('/files/*', {
    schema: {
      description: 'Get a file from S3 storage',
      tags: ['files'],
      params: {
        type: 'object',
        properties: {
          '*': { type: 'string', description: 'S3 object key (file path)' }
        },
        required: ['*']
      },
      response: {
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        },
        500: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const s3Key = request.params['*'];

    if (!s3Key) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'MISSING_KEY',
          message: 'S3 key is required'
        }
      });
    }

    // Determine which bucket to use based on the key prefix
    const bucketName = getBucketForKey(s3Key);

    if (!bucketName) {
      fastify.log.error({ s3Key }, 'Could not determine bucket for key');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'S3_NOT_CONFIGURED',
          message: 'S3 storage is not configured for this file type'
        }
      });
    }

    try {
      const s3Client = getS3Client();

      fastify.log.info({ bucket: bucketName, key: s3Key }, 'Fetching file from S3');

      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in storage'
          }
        });
      }

      // Get content type from S3 response or infer from file extension
      const contentType = response.ContentType || getContentType(s3Key);

      // Set response headers
      reply.header('Content-Type', contentType);
      // Allow caching for 1 hour
      reply.header('Cache-Control', 'public, max-age=3600');

      // For PDFs, set inline disposition so they display in the browser
      const filename = s3Key.split('/').pop() || 'file';
      if (contentType === 'application/pdf') {
        // Use RFC 5987 encoding for non-ASCII filenames
        const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
        reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodedFilename}`);
      }

      // Stream the S3 response body to the client
      const stream = response.Body as Readable;

      if (response.ContentLength) {
        reply.header('Content-Length', response.ContentLength);
      }
      return reply.send(stream);
    } catch (error) {
      fastify.log.error({ error, s3Key }, 'Failed to fetch file from S3');

      // Check for specific S3 errors
      if (error instanceof Error && error.name === 'NoSuchKey') {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'File not found in storage'
          }
        });
      }

      return reply.status(500).send({
        success: false,
        error: {
          code: 'S3_ERROR',
          message: 'Failed to retrieve file from storage'
        }
      });
    }
  });

  // Health check for S3 connectivity
  fastify.get('/files-health', {
    schema: {
      description: 'Check S3 connectivity',
      tags: ['files'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                s3Configured: { type: 'boolean' },
                buckets: { type: 'object' },
                defaultBucket: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    return reply.send({
      success: true,
      data: {
        s3Configured: !!(env.AWS_ACCESS_KEY_ID),
        pdfBucket: PDF_BUCKET,
        supportedPrefixes: VALID_PREFIXES
      }
    });
  });
}
