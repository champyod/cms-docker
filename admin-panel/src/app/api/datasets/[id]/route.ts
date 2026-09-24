import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { getFieldAccess } from '@/lib/field-permissions';
import { getPermissions } from '@/lib/permissions';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('dataset:update');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = (await req.json()) as Record<string, unknown>;
    const access = getFieldAccess('datasets', await getPermissions());
    const canUpdate = (field: string): boolean => access[field]?.canUpdate === true;
    const fieldDenied = (field: string): Response | null => {
      if (canUpdate(field)) return null;
      return apiError({ message: 'Permission denied for ' + field + ' field', status: 403 });
    };

    if (data.action === 'rename') {
      if (!canUpdate('description') || typeof data.description !== 'string') {
        return apiError({ message: 'Permission denied for dataset description', status: 403 });
      }
       await prisma.datasets.update({ where: { id }, data: { description: data.description as string } });
    } else if (data.action === 'activate') {
       const switchAuth = await verifyApiPermission('dataset:switch');
       if (!switchAuth.authorized) return switchAuth.response as Response;
       const taskSwitchAuth = await verifyApiPermission('task:switch_dataset');
       if (!taskSwitchAuth.authorized) return taskSwitchAuth.response as Response;
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.tasks.update({ where: { id: d.task_id }, data: { active_dataset_id: id } });
    } else if (data.action === 'toggle-autojudge') {
       if (!canUpdate('autojudge')) {
         return apiError({ message: 'Permission denied for autojudge field', status: 403 });
       }
       const d = await prisma.datasets.findUnique({ where: { id } });
       if (!d) return apiError({ message: 'Dataset not found', status: 404 });
       await prisma.datasets.update({ where: { id }, data: { autojudge: !d.autojudge } });
    } else {
       const updateData: Record<string, unknown> = {};
        if (data.time_limit !== undefined) {
          const denied = fieldDenied('time_limit');
          if (denied) return denied;
          updateData.time_limit = data.time_limit as number | null;
        }
        if (data.memory_limit !== undefined) {
          const denied = fieldDenied('memory_limit');
          if (denied) return denied;
          updateData.memory_limit = data.memory_limit ? BigInt((data.memory_limit as number) * 1024 * 1024) : null;
        }
        if (data.task_type) {
          const denied = fieldDenied('task_type');
          if (denied) return denied;
          updateData.task_type = data.task_type as string;
        }
        if (data.score_type) {
          const denied = fieldDenied('score_type');
          if (denied) return denied;
          updateData.score_type = data.score_type as string;
        }
        if (data.score_type_parameters !== undefined) {
          const denied = fieldDenied('score_type_parameters');
          if (denied) return denied;
         const scoreParams = data.score_type_parameters as unknown;
         if (typeof scoreParams !== 'number' && !Array.isArray(scoreParams)) {
           return apiError({ message: 'Score parameters must be a number or an array', status: 400 });
         }
         updateData.score_type_parameters = scoreParams;
       }
        if (data.task_type_parameters !== undefined) {
          const denied = fieldDenied('task_type_parameters');
          if (denied) return denied;
         const taskParams = data.task_type_parameters as unknown;
         if (!Array.isArray(taskParams)) {
           return apiError({ message: 'Task type parameters must be an array', status: 400 });
         }
         updateData.task_type_parameters = taskParams;
       }
       await prisma.datasets.update({ where: { id }, data: updateData });
    }

    await recordAudit({
      verb: 'dataset:update',
      entity: 'dataset',
      entityId: String(id),
      afterValues: { action: (data.action as string) ?? 'update', datasetId: id },
      result: 'success',
    });
     revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Dataset updated successfully' });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('dataset:delete');
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

    const beforeDataset = await prisma.datasets.findUnique({ where: { id }, select: { description: true, task_id: true } });
    await prisma.datasets.delete({ where: { id } });
    await recordAudit({
      verb: 'dataset:delete',
      entity: 'dataset',
      entityId: String(id),
      beforeValues: beforeDataset ? { description: beforeDataset.description, task_id: beforeDataset.task_id } : undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Dataset deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
