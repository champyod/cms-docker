import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  try {
    const data = await req.json();
    const { taskId, ...datasetData } = data;

    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: datasetData.description,
        time_limit: datasetData.time_limit || null,
        memory_limit: datasetData.memory_limit ? BigInt(datasetData.memory_limit * 1024 * 1024) : null,
        task_type: datasetData.task_type || 'Batch',
        task_type_parameters: [],
        score_type: datasetData.score_type || 'Sum',
        score_type_parameters: [],
        autojudge: false,
      }
    });

    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath(`/[locale]/tasks/${taskId}`, 'page');
    return apiSuccess({ dataset });
  } catch (error: any) {
    return apiError(error);
  }
}
