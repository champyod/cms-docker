import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  try {
    const data = (await req.json()) as { taskId: number; description: string; time_limit?: number; memory_limit?: number; task_type?: string; score_type?: string };
    const { taskId, ...datasetData } = data;

    if (!Number.isInteger(taskId) || taskId <= 0) return apiError({ message: 'Valid task identifier is required', status: 400 });
    const descriptionTrimmed = typeof datasetData.description === 'string' ? datasetData.description.trim() : '';
    if (!descriptionTrimmed) return apiError({ message: 'Dataset description is required', status: 400 });
    if (descriptionTrimmed.length > 500) return apiError({ message: 'Description must be at most 500 characters', status: 400 });
    if (datasetData.time_limit !== undefined && datasetData.time_limit !== null) {
      const timeLimit = Number(datasetData.time_limit);
      if (!Number.isFinite(timeLimit) || timeLimit <= 0 || timeLimit > 60) return apiError({ message: 'Time limit must be between 1 and 60 seconds', status: 400 });
    }
    if (datasetData.memory_limit !== undefined && datasetData.memory_limit !== null) {
      const memoryLimit = Number(datasetData.memory_limit);
      if (!Number.isFinite(memoryLimit) || memoryLimit <= 0 || memoryLimit > 4096) return apiError({ message: 'Memory limit must be between 1 and 4096 megabytes', status: 400 });
    }

    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: descriptionTrimmed,
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

    const responseDataset = {
      ...dataset,
      memory_limit: dataset.memory_limit ? dataset.memory_limit.toString() : null
    };

    return apiSuccess({ dataset: responseDataset });
  } catch (error) {
    return apiError(error);
  }
}
