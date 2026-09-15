import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/api-utils';
import * as taskService from '@/lib/services/tasks';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = parseInt((await params).id, 10);
  try {
    const diagnostics = await taskService.getDiagnosticsForApi(id);
    return apiSuccess({ diagnostics });
  } catch (error: unknown) {
    const e = error as { status?: number; message?: string };
    if (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 404) return apiError({ message: e.message, status: e.status });
    return apiError(error);
  }
}
