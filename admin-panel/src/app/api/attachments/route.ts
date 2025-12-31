import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

async function storeFile(data: Buffer): Promise<string> {
  const digest = crypto.createHash('sha256').update(data).digest('hex');

  const existing = await prisma.$queryRaw<any[]>`
    SELECT digest FROM fsobjects WHERE digest = ${digest}
  `;

  if (existing.length === 0) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT lo_from_bytea(0, ${data}::bytea) as lob_oid
    `;
    const lobOid = result[0].lob_oid;

    await prisma.$executeRaw`
      INSERT INTO fsobjects (digest, lob_oid, description)
      VALUES (${digest}, ${lobOid}, 'Uploaded via Admin API')
    `;
  }

  return digest;
}

export async function POST(req: NextRequest) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  try {
    const data = await req.json();
    const { taskId, filename, fileData } = data;

    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO attachments (task_id, filename, digest)
      VALUES (${taskId}, ${filename}, ${digest})
      ON CONFLICT (task_id, filename) 
      DO UPDATE SET digest = ${digest}
    `;

    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath(`/[locale]/tasks/${taskId}`, 'page');
    return apiSuccess({ digest });
  } catch (error: any) {
    return apiError(error);
  }
}
