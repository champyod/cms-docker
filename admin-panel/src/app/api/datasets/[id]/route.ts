import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    
    // We handle custom actions if provided in the body or standard update
    if (data.action === 'rename') {
       await prisma.datasets.update({ where: { id }, data: { description: data.description } });
    } else if (data.action === 'activate') {
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.tasks.update({ where: { id: d.task_id }, data: { active_dataset_id: id } });
    } else if (data.action === 'toggle-autojudge') {
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.datasets.update({ where: { id }, data: { autojudge: !d.autojudge } });
    } else {
       await prisma.datasets.update({
         where: { id },
         data: {
           ...(data.time_limit !== undefined && { time_limit: data.time_limit }),
           ...(data.memory_limit !== undefined && { 
             memory_limit: data.memory_limit ? BigInt(data.memory_limit * 1024 * 1024) : null 
           }),
           ...(data.task_type && { task_type: data.task_type }),
           ...(data.score_type && { score_type: data.score_type }),
         }
       });
    }

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Dataset updated successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

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
  } catch (error: any) {
    return apiError(error);
  }
}
