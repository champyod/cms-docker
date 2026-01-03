import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
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
      VALUES (${digest}, ${lobOid}, 'Uploaded via Admin API (Manager)')
    `;
  }

  return digest;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response;

  const datasetId = parseInt((await params).id);
  if (isNaN(datasetId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const managers = await prisma.managers.findMany({
      where: { dataset_id: datasetId },
      select: { id: true, filename: true, digest: true },
      orderBy: { filename: 'asc' }
    });
    return apiSuccess(managers);
  } catch (error: any) {
    return apiError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response;

  const datasetId = parseInt((await params).id);
  if (isNaN(datasetId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const { filename, fileData } = data;

    if (!filename || !fileData) {
      return apiError({ message: 'Missing filename or fileData', status: 400 });
    }

    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    // Upsert manager
    await prisma.$executeRaw`
      INSERT INTO managers (dataset_id, filename, digest)
      VALUES (${datasetId}, ${filename}, ${digest})
      ON CONFLICT (dataset_id, filename) 
      DO UPDATE SET digest = ${digest}
    `;

    return apiSuccess({ digest });
  } catch (error: any) {
    return apiError(error);
  }
}
