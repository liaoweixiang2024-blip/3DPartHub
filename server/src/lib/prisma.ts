import { PrismaClient } from '@prisma/client';
import { createLogger } from './logger.js';

const log = createLogger({ component: 'prisma' });

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Inject connection pool params into DATABASE_URL if not already set.
// Prisma for PostgreSQL supports connection_limit and pool_timeout as URL params.
// Default: 10 connections per worker. Total = connection_limit × API workers.
let dbUrl = process.env.DATABASE_URL || '';
try {
  const url = new URL(dbUrl);
  if (!url.searchParams.has('connection_limit')) {
    const limit = Number(process.env.DB_CONNECTION_LIMIT) || 10;
    url.searchParams.set('connection_limit', String(limit));
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', '10');
  }
  dbUrl = url.toString();
} catch {}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: { url: dbUrl },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown — disconnect Prisma before exiting
async function shutdown(signal: string) {
  log.info({ signal }, 'Received shutdown signal, disconnecting Prisma');
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
