import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { computeTaskDiagnostics } from '@/lib/task-diagnostics';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });
  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });
  try {
    const task = await prisma.tasks.findUnique({ where: { id }, select: { id: true } });
    if (!task) return apiError({ message: 'Task not found', status: 404 });
    const diagnostics = await computeTaskDiagnostics(id);
    return apiSuccess({ diagnostics });
  } catch (error) {
    return apiError(error);
  }
}
