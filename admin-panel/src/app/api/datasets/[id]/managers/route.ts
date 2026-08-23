import { prisma } from '@/lib/prisma';
import { verifyApiAuth, verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { storeFile } from '@/lib/fsobjects';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiAuth();
  if (!authorized) return response as Response;

  const datasetId = parseInt((await params).id, 10);
  if (Number.isNaN(datasetId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const managers = await prisma.managers.findMany({
      where: { dataset_id: datasetId },
      select: { id: true, filename: true, digest: true },
      orderBy: { filename: 'asc' },
    });
    return apiSuccess(managers);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response as Response;

  const datasetId = parseInt((await params).id, 10);
  if (Number.isNaN(datasetId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = (await req.json()) as { filename?: string; fileData?: string };
    const { filename, fileData } = data;

    if (!filename || !fileData) {
      return apiError({ message: 'Missing filename or fileData', status: 400 });
    }

    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer, 'Uploaded via Admin API (Manager)');

    // Upsert manager
    await prisma.$executeRaw`
      INSERT INTO managers (dataset_id, filename, digest)
      VALUES (${datasetId}, ${filename}, ${digest})
      ON CONFLICT (dataset_id, filename) 
      DO UPDATE SET digest = ${digest}
    `;

    return apiSuccess({ digest });
  } catch (error) {
    return apiError(error);
  }
}
