/**
 * Auth Routes - Full Implementation
 *
 * Secure user authentication with bcrypt password hashing, JWT tokens,
 * httpOnly cookie refresh tokens, and rate limiting.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/database';
import { authConfig } from '../config/auth';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
  extractTokenFromHeader,
} from '../utils/auth';
import {
  registerSchema,
  loginSchema,
  registerJsonSchema,
  loginJsonSchema,
  validatePassword,
} from '../utils/validation';

// Rate limit configurations
const loginRateLimit = {
  max: 5,
  timeWindow: '15 minutes',
};

const registerRateLimit = {
  max: 3,
  timeWindow: '1 hour',
};

const refreshRateLimit = {
  max: 10,
  timeWindow: '1 minute',
};

interface RegisterBody {
  email: string;
  password: string;
  fullName: string;
  organization: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export default async function authRoutes(fastify: FastifyInstance) {
  // Register endpoint
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    {
      config: {
        rateLimit: registerRateLimit,
      },
      schema: {
        description: 'Register a new user',
        tags: ['auth'],
        body: registerJsonSchema,
      },
    },
    async (request, reply) => {
      try {
        const validationResult = registerSchema.safeParse(request.body);
        if (!validationResult.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: validationResult.error.errors,
            },
          });
        }

        const { email, password, fullName, organization } = validationResult.data;

        // Validate password requirements
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'WEAK_PASSWORD',
              message: passwordValidation.errors.join('. '),
            },
          });
        }

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });

        if (existingUser) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'EMAIL_EXISTS',
              message: 'An account with this email already exists',
            },
          });
        }

        // Hash password and create user
        const passwordHash = await hashPassword(password);
        const user = await prisma.user.create({
          data: {
            email: email.toLowerCase(),
            passwordHash,
            fullName,
            organization,
            role: 'VIEWER', // Default role
          },
        });

        // Auto-login: Generate tokens and create session
        const accessToken = generateAccessToken({
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        const session = await prisma.userSession.create({
          data: {
            userId: user.id,
            refreshToken: '', // Will update after generating
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        });

        const refreshToken = generateRefreshToken({
          userId: user.id,
          sessionId: session.id,
        });

        await prisma.userSession.update({
          where: { id: session.id },
          data: { refreshToken },
        });

        // Set refresh token cookie
        reply.setCookie('refreshToken', refreshToken, authConfig.cookie);

        fastify.log.info({ userId: user.id }, 'User registered and logged in successfully');

        return {
          success: true,
          data: {
            accessToken,
            user: {
              id: user.id,
              email: user.email,
              fullName: user.fullName,
              organization: user.organization,
              role: user.role,
            },
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Registration failed',
          },
        });
      }
    }
  );

  // Login endpoint
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      config: {
        rateLimit: loginRateLimit,
      },
      schema: {
        description: 'Login with email and password',
        tags: ['auth'],
        body: loginJsonSchema,
      },
    },
    async (request, reply) => {
      try {
        const validationResult = loginSchema.safeParse(request.body);
        if (!validationResult.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid input',
              details: validationResult.error.errors,
            },
          });
        }

        const { email, password } = validationResult.data;

        // Find user by email
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });

        if (!user) {
          // Use generic message to prevent email enumeration
          return reply.status(401).send({
            success: false,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password',
            },
          });
        }

        // Verify password
        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password',
            },
          });
        }

        // Generate tokens
        const accessToken = generateAccessToken({
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        // Create session and refresh token
        const session = await prisma.userSession.create({
          data: {
            userId: user.id,
            refreshToken: '', // Will update after generating
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        });

        const refreshToken = generateRefreshToken({
          userId: user.id,
          sessionId: session.id,
        });

        // Update session with refresh token
        await prisma.userSession.update({
          where: { id: session.id },
          data: { refreshToken },
        });

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Set refresh token cookie
        reply.setCookie('refreshToken', refreshToken, authConfig.cookie);

        fastify.log.info({ userId: user.id }, 'User logged in successfully');

        return {
          success: true,
          data: {
            accessToken,
            user: {
              id: user.id,
              email: user.email,
              fullName: user.fullName,
              organization: user.organization,
              role: user.role,
            },
          },
        };
      } catch (error: any) {
        fastify.log.error({ err: error, message: error?.message, stack: error?.stack }, 'Login error');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Login failed: ${error?.message || 'Unknown error'}`,
          },
        });
      }
    }
  );

  // Logout endpoint
  fastify.post('/logout', async (request, reply) => {
    try {
      const refreshToken = request.cookies.refreshToken;

      if (refreshToken) {
        // Delete the session
        await prisma.userSession.deleteMany({
          where: { refreshToken },
        });
      }

      // Clear the cookie
      reply.clearCookie('refreshToken', {
        path: authConfig.cookie.path,
      });

      return {
        success: true,
        data: { message: 'Logged out successfully' },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Logout failed',
        },
      });
    }
  });

  // Refresh token endpoint
  fastify.post(
    '/refresh',
    {
      config: {
        rateLimit: refreshRateLimit,
      },
      schema: {
        description: 'Refresh access token',
        tags: ['auth'],
      },
    },
    async (request, reply) => {
      try {
        const refreshToken = request.cookies.refreshToken;

        if (!refreshToken) {
          return reply.status(401).send({
            success: false,
            error: {
              code: 'NO_REFRESH_TOKEN',
              message: 'Refresh token not found',
            },
          });
        }

        // Verify refresh token (validates signature, we look up session by token)
        try {
          verifyRefreshToken(refreshToken);
        } catch {
          // Clear invalid cookie
          reply.clearCookie('refreshToken', { path: authConfig.cookie.path });
          return reply.status(401).send({
            success: false,
            error: {
              code: 'INVALID_REFRESH_TOKEN',
              message: 'Invalid or expired refresh token',
            },
          });
        }

        // Find session
        const session = await prisma.userSession.findUnique({
          where: { refreshToken },
          include: { user: true },
        });

        if (!session || session.expiresAt < new Date()) {
          // Delete expired session if exists
          if (session) {
            await prisma.userSession.delete({ where: { id: session.id } });
          }
          reply.clearCookie('refreshToken', { path: authConfig.cookie.path });
          return reply.status(401).send({
            success: false,
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Session has expired. Please login again.',
            },
          });
        }

        // Generate new access token
        const accessToken = generateAccessToken({
          userId: session.user.id,
          email: session.user.email,
          role: session.user.role,
        });

        return {
          success: true,
          data: {
            accessToken,
            user: {
              id: session.user.id,
              email: session.user.email,
              fullName: session.user.fullName,
              organization: session.user.organization,
              role: session.user.role,
            },
          },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Token refresh failed',
          },
        });
      }
    }
  );

  // Get current user endpoint
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractTokenFromHeader(request.headers.authorization);

      if (!token) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'NO_TOKEN',
            message: 'Access token required',
          },
        });
      }

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid or expired access token',
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          organization: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      return {
        success: true,
        data: user,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get user info',
        },
      });
    }
  });
}
