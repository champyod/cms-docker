import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = (() => {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const client = new PrismaClient({
    // Why: query-level logging buries the surrounding deploy output (the permission
    // seed alone prints hundreds of statements); errors and warnings stay enabled so
    // a failed seed still reports its cause.
    log: ['error', 'warn'],
  });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
})();
