import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiError, apiSuccess } from '@/lib/api-utils';
import * as taskService from '@/lib/services/tasks';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseInt((await params).id, 10);
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const result = await taskService.updateTaskViaApi(id, raw);
    if (!result.success) return apiError({ message: result.error ?? 'Task update failed', status: 400 });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task updated successfully' });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403 || e.status === 400) return apiError({ message: e.message, status: e.status });
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseInt((await params).id, 10);
  try {
    const result = await taskService.deleteTaskViaApi(id);
    if (!result.success) return apiError({ message: result.error ?? 'Task deletion failed', status: 400 });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Task deleted successfully' });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403 || e.status === 400) return apiError({ message: e.message, status: e.status });
    return apiError(error);
  }
}
