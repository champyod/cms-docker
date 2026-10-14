import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess, parseIdList } from '@/lib/api-utils';
import * as taskService from '@/lib/services/tasks';

const BATCH_ACTIONS = ['assign'] as const;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = BATCH_ACTIONS.find((candidate) => candidate === body?.action);
    const taskIds = parseIdList(body.taskIds);

    if (action !== 'assign') {
      return apiError({ message: 'Invalid action', status: 400 });
    }
    if (taskIds.length === 0) {
      return apiError({ message: 'taskIds is required', status: 400 });
    }
    if (body.contestIds !== undefined && !Array.isArray(body.contestIds)) {
      return apiError({ message: 'contestIds must be an array', status: 400 });
    }
    const contestIds = parseIdList(body.contestIds ?? []);

    // Why sequential and not Promise.all: each assignment reads MAX(num) + 1 for
    // the destination contest, so running them in order lets the next task see the
    // number the previous one just took instead of colliding on it.
    // An empty contestIds means "remove from every contest".
    const targets: Array<number | null> = contestIds.length > 0 ? contestIds : [null];
    const failed: Array<{ id: number; reason?: string }> = [];
    let assignedCount = 0;
    for (const taskId of taskIds) {
      for (const contestId of targets) {
        const result = await taskService.assignTaskToContest(taskId, contestId);
        if (result.success) assignedCount += 1;
        else failed.push({ id: taskId, reason: result.error });
      }
    }

    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath('/[locale]/contests', 'page');
    return apiSuccess({ assignedCount, failed, contestIds });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403) {
      return apiError({ message: e.message, status: e.status });
    }
    return apiError(error);
  }
}
