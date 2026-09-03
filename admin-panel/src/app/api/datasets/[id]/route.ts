import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = (await req.json()) as Record<string, unknown>;
    
    if (data.action === 'rename') {
       await prisma.datasets.update({ where: { id }, data: { description: data.description as string } });
    } else if (data.action === 'activate') {
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.tasks.update({ where: { id: d.task_id }, data: { active_dataset_id: id } });
    } else if (data.action === 'toggle-autojudge') {
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.datasets.update({ where: { id }, data: { autojudge: !d.autojudge } });
    } else {
       const updateData: Record<string, unknown> = {};
       if (data.time_limit !== undefined) updateData.time_limit = data.time_limit as number | null;
       if (data.memory_limit !== undefined) updateData.memory_limit = data.memory_limit ? BigInt((data.memory_limit as number) * 1024 * 1024) : null;
       if (data.task_type) updateData.task_type = data.task_type as string;
       if (data.score_type) updateData.score_type = data.score_type as string;
       await prisma.datasets.update({ where: { id }, data: updateData });
    }

     revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Dataset updated successfully' });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id },
      include: { tasks_datasets_task_idTotasks: true }
    });
    
    if (dataset?.tasks_datasets_task_idTotasks?.active_dataset_id === id) {
      return apiError({ message: 'Cannot delete the active dataset', status: 400 });
    }

    await prisma.datasets.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Dataset deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
