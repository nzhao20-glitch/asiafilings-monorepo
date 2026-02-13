import { PrismaClient } from '@prisma/client';
import { isDevelopment, isProduction } from '../config/environment';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = globalThis.prisma || new PrismaClient({
  log: isDevelopment() ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty'
});

if (!isProduction()) {
  globalThis.prisma = prisma;
}

export { prisma };