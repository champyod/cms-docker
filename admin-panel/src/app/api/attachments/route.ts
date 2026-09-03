import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { storeFile } from '@/lib/fsobjects';

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  try {
    const data = (await req.json()) as { taskId: number; filename: string; fileData: string };
    const { taskId, filename, fileData } = data;

    if (!Number.isInteger(taskId) || taskId <= 0) return apiError({ message: 'Valid task identifier is required', status: 400 });
    const filenameTrimmed = typeof filename === 'string' ? filename.trim() : '';
    if (!filenameTrimmed) return apiError({ message: 'Filename is required', status: 400 });
    if (filenameTrimmed.includes('/') || filenameTrimmed.includes('\\') || filenameTrimmed.includes('..')) return apiError({ message: 'Filename must not contain path separators', status: 400 });
    if (filenameTrimmed.length > 255) return apiError({ message: 'Filename must be at most 255 characters', status: 400 });
    if (typeof fileData !== 'string' || fileData.length === 0) return apiError({ message: 'File data is required', status: 400 });
    if (fileData.length > 15 * 1024 * 1024) return apiError({ message: 'File too large', status: 400 });

    const buffer = Buffer.from(fileData, 'base64');
    if (buffer.length === 0) return apiError({ message: 'File data is empty after decoding', status: 400 });
    if (buffer.length > 10 * 1024 * 1024) return apiError({ message: 'Decoded file exceeds 10 megabytes', status: 400 });
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO attachments (task_id, filename, digest)
      VALUES (${taskId}, ${filenameTrimmed}, ${digest})
      ON CONFLICT (task_id, filename) 
      DO UPDATE SET digest = ${digest}
    `;

    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath(`/[locale]/tasks/${taskId}`, 'page');
    return apiSuccess({ digest });
  } catch (error) {
    return apiError(error);
  }
}
