import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess } from '@/lib/api-utils';
import * as taskService from '@/lib/services/tasks';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const data = (await req.json()) as Record<string, unknown>;
    const result = await taskService.createTaskViaApi(data);
    if (!result.success) return apiError({ message: result.error ?? 'Task creation failed', status: 400 });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task created successfully' });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403 || e.status === 400) return apiError({ message: e.message, status: e.status });
    return apiError(error);
  }
}
