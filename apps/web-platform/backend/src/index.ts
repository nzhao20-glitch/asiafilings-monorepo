// Load environment configuration FIRST before any other imports
import './config/environment';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, isProduction, isDevelopment } from './config/environment';
import { prisma } from './lib/database';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';

export const buildApp = async () => {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: !isProduction() 
        ? { target: 'pino-pretty' }
        : undefined
    }
  });

  // Register plugins
  await fastify.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true
  });

  await fastify.register(cookie, {
    secret: env.COOKIE_SECRET
  });

  await fastify.register(sensible);

  // Rate limiting for brute force protection
  await fastify.register(rateLimit, {
    global: false, // Only apply to routes with rateLimit config
    max: 100,
    timeWindow: '1 minute',
  });

  await fastify.register(jwt, {
    secret: env.JWT_SECRET
  });

  // Register auth middleware decorator
  fastify.decorate('authenticate', authMiddleware);

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'AsiaFilings API',
        description: 'API for managing and viewing DART filings for institutional investors',
        version: '1.0.0'
      },
      servers: [
        {
          url: env.API_URL || `http://${env.HOST}:${env.PORT}`,
          description: isDevelopment() ? 'Development server' : 'Production server'
        }
      ]
    }
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });

  // Health check endpoint
  fastify.get('/health', async (_request, reply) => {
    try {
      // Test database connection
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'connected'
      };
    } catch (error) {
      reply.status(503);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Basic route
  fastify.get('/', async (_request, _reply) => {
    return {
      message: 'AsiaFilings API',
      version: '1.0.0',
      documentation: '/documentation'
    };
  });

  // Global error handler to format all errors consistently
  fastify.setErrorHandler((error, _request, reply) => {
    // Handle validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.validation
        }
      });
    }

    // Handle other Fastify errors
    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code || 'REQUEST_ERROR',
          message: error.message
        }
      });
    }

    // Handle unexpected errors
    fastify.log.error(error);
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      }
    });
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  
  // Import and register DART routes
  const companyRoutes = await import('./routes/companies');
  const filingRoutes = await import('./routes/filings');
  const enhancedFilingRoutes = await import('./routes/filings-enhanced');
  const searchRoutes = await import('./routes/search');
  const filesRoutes = await import('./routes/files');

  await fastify.register(companyRoutes.default, { prefix: '/api' });
  await fastify.register(filingRoutes.default, { prefix: '/api' });
  await fastify.register(enhancedFilingRoutes.default, { prefix: '/api' });
  // TODO: Document routes will be re-implemented when document processing is added
  await fastify.register(searchRoutes.default, { prefix: '/api' });
  await fastify.register(filesRoutes.default, { prefix: '/api' });

  const documentRoutes = await import('./routes/documents');
  await fastify.register(documentRoutes.default, { prefix: '/api' });

  const quickwitSearchRoutes = await import('./routes/quickwit-search');
  await fastify.register(quickwitSearchRoutes.default, { prefix: '/api' });

  // TODO: Initialize scheduled jobs when implemented

  return fastify;
};

const start = async () => {
  try {
    const fastify = await buildApp();

    await fastify.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Server running at http://${env.HOST}:${env.PORT}`);
    console.log(`📚 API Documentation available at http://${env.HOST}:${env.PORT}/documentation`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// Only start server if this file is run directly (not imported for testing)
if (require.main === module) {
  start();
}