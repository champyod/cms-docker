import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { storeFile } from '@/lib/fsobjects';
import { recordAudit } from '@/lib/audit';
import { normalizeLanguageCode } from '@/lib/constants/languages';

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('statement:create');
  if (!authorized) return response;

  try {
    const data = (await req.json()) as { taskId: number; language: string; fileData: string };
    const { taskId, fileData } = data;
    // Why: normalize before storage so exact equality in task_description.html:60 works regardless of caller casing/whitespace
    const language = normalizeLanguageCode(String(data.language ?? ''));
    if (!language) return apiError({ message: 'Language is required', status: 400 });

    const buffer = Buffer.from(fileData, 'base64');
    const digest = await storeFile(buffer);

    await prisma.$executeRaw`
      INSERT INTO statements (task_id, language, digest)
      VALUES (${taskId}, ${language}, ${digest})
      ON CONFLICT (task_id, language)
      DO UPDATE SET digest = ${digest}
    `;

    await recordAudit({
      verb: 'statement:create',
      entity: 'statement',
      afterValues: { taskId, language },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath(`/[locale]/tasks/${taskId}`, 'page');
    return apiSuccess({ digest });
  } catch (error) {
    return apiError(error);
  }
}
