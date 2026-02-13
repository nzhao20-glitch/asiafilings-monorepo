import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, extractTokenFromHeader } from '../utils/auth';

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const token = extractTokenFromHeader(request.headers.authorization);

    if (!token) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'No authentication token provided',
        },
      });
    }

    const payload = verifyAccessToken(token);
    request.user = payload;
  } catch (error) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      },
    });
  }
}