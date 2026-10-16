import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { validateTaskTypeParams, DEFAULT_TASK_TYPE } from '@/lib/tasktype-params';
import { mebibytesToBytes, parseMemoryLimitMb, parseTimeLimit } from '@/lib/dataset-limits';

type ResolvedTaskType =
  | { isValid: true; taskType: string; params: unknown[] }
  | { isValid: false; response: Response };

function resolveTaskType(data: { task_type?: string; task_type_parameters?: unknown }): ResolvedTaskType {
  const taskType = data.task_type || DEFAULT_TASK_TYPE;
  const result = validateTaskTypeParams(taskType, data.task_type_parameters);
  if (!result.isValid) {
    return { isValid: false, response: apiError({ message: result.message, status: 400 }) };
  }
  return { isValid: true, taskType, params: result.params };
}

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('dataset:create');
  if (!authorized) return response;

  try {
    const data = (await req.json()) as { taskId: number; description: string; time_limit?: number; memory_limit?: number; task_type?: string; score_type?: string; task_type_parameters?: unknown; score_type_parameters?: unknown };
    const { taskId, ...datasetData } = data;

    if (!Number.isInteger(taskId) || taskId <= 0) return apiError({ message: 'Valid task identifier is required', status: 400 });
    const descriptionTrimmed = typeof datasetData.description === 'string' ? datasetData.description.trim() : '';
    if (!descriptionTrimmed) return apiError({ message: 'Dataset description is required', status: 400 });
    if (descriptionTrimmed.length > 500) return apiError({ message: 'Description must be at most 500 characters', status: 400 });
    // Why parse before storing: a blank box, a 0 and a null all mean "no limit" and must land as
    // SQL NULL, while a fractional MiB has to be answered rather than silently dropped.
    const timeLimit = parseTimeLimit(datasetData.time_limit);
    if (!timeLimit.ok) return apiError({ message: timeLimit.message, status: 400 });
    const memoryLimit = parseMemoryLimitMb(datasetData.memory_limit);
    if (!memoryLimit.ok) return apiError({ message: memoryLimit.message, status: 400 });
    const taskType = resolveTaskType(datasetData);
    if (!taskType.isValid) return taskType.response;

    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: descriptionTrimmed,
        time_limit: timeLimit.value,
        memory_limit: mebibytesToBytes(memoryLimit.value),
        task_type: taskType.taskType,
        task_type_parameters: taskType.params as Prisma.InputJsonValue,
        score_type: datasetData.score_type || 'Sum',
        score_type_parameters: (datasetData.score_type_parameters ?? []) as Prisma.InputJsonValue,
        autojudge: false,
      }
    });

    await recordAudit({
      verb: 'dataset:create',
      entity: 'dataset',
      entityId: String(dataset.id),
      afterValues: { taskId, description: descriptionTrimmed },
      result: 'success',
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
