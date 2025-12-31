import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const task = await prisma.tasks.findUnique({
      where: { id },
      include: {
        statements: { select: { id: true } },
        datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true } } } }
      }
    });

    if (!task) return apiError({ message: 'Task not found', status: 404 });

    const diagnostics: any[] = [];
    if (!task.active_dataset_id) {
      diagnostics.push({ type: 'error', message: 'No active dataset selected. Task cannot be judged.' });
    }

    const activeDataset = task.active_dataset_id 
      ? await prisma.datasets.findUnique({ 
          where: { id: task.active_dataset_id }, 
          include: { testcases: { select: { id: true } } } 
        }) 
      : null;

    if (task.active_dataset_id && (!activeDataset?.testcases || activeDataset.testcases.length === 0)) {
      diagnostics.push({ type: 'error', message: 'Active dataset has no test cases.' });
    }

    if (task.statements.length === 0) {
      diagnostics.push({ type: 'error', message: 'No statements found. Users won\'t see instructions.' });
    }

    if (!task.contest_id) {
      diagnostics.push({ type: 'warning', message: 'Not assigned to any contest.' });
    }

    return apiSuccess({ diagnostics });
  } catch (error: any) {
    return apiError(error);
  }
}
