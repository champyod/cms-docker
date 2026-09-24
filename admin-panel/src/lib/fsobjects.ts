import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export const DEFAULT_FILE_DESCRIPTION = 'Uploaded via Admin Panel';

export function calculateDigest(data: Buffer): string {
  return crypto.createHash('sha1').update(data).digest('hex');
}

export async function storeFile(
  data: Buffer,
  description: string = DEFAULT_FILE_DESCRIPTION
): Promise<string> {
  const digest = calculateDigest(data);

  const existing = await prisma.$queryRaw<{ digest: string }[]>`
    SELECT digest FROM fsobjects WHERE digest = ${digest}
  `;

  if (existing.length === 0) {
    const result = await prisma.$queryRaw<{ loid: number }[]>`
      SELECT lo_from_bytea(0, ${data}::bytea) as loid
    `;
    const lobOid = result[0].loid;

    await prisma.$executeRaw`
      INSERT INTO fsobjects (digest, loid, description)
      VALUES (${digest}, ${lobOid}, ${description})
    `;
  }

  return digest;
}
