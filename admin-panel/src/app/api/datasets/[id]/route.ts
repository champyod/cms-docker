import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { getFieldAccess } from '@/lib/field-permissions';
import { getPermissions } from '@/lib/permissions';
import { isEmptyTaskTypeParams, validateTaskTypeParams, DEFAULT_TASK_TYPE } from '@/lib/tasktype-params';

type FieldGate = (field: string) => boolean;

type FieldUpdate =
  | { isValid: true; updateData: Record<string, unknown> }
  | { isValid: false; response: Response };

function deniedField(field: string): FieldUpdate {
  return { isValid: false, response: apiError({ message: 'Permission denied for ' + field + ' field', status: 403 }) };
}

/** Fields stored as they arrive, each behind its own field permission. */
function buildDirectFields(data: Record<string, unknown>, canUpdate: FieldGate): FieldUpdate {
  const updateData: Record<string, unknown> = {};
  if (data.time_limit !== undefined) {
    if (!canUpdate('time_limit')) return deniedField('time_limit');
    updateData.time_limit = data.time_limit as number | null;
  }
  if (data.memory_limit !== undefined) {
    if (!canUpdate('memory_limit')) return deniedField('memory_limit');
    updateData.memory_limit = data.memory_limit ? BigInt((data.memory_limit as number) * 1024 * 1024) : null;
  }
  if (data.task_type) {
    if (!canUpdate('task_type')) return deniedField('task_type');
    updateData.task_type = data.task_type as string;
  }
  if (data.score_type) {
    if (!canUpdate('score_type')) return deniedField('score_type');
    updateData.score_type = data.score_type as string;
  }
  if (data.score_type_parameters !== undefined) {
    if (!canUpdate('score_type_parameters')) return deniedField('score_type_parameters');
    if (typeof data.score_type_parameters !== 'number' && !Array.isArray(data.score_type_parameters)) {
      return { isValid: false, response: apiError({ message: 'Score parameters must be a number or an array', status: 400 }) };
    }
    updateData.score_type_parameters = data.score_type_parameters;
  }
  return { isValid: true, updateData };
}

/** A task type change is checked against the list the dataset already stores,
 *  because the worker pairs the two when it builds the task type. */
async function buildTaskTypeParamsUpdate(data: Record<string, unknown>, id: number, canUpdate: FieldGate): Promise<FieldUpdate> {
  const hasParams = data.task_type_parameters !== undefined;
  const hasType = typeof data.task_type === 'string' && data.task_type !== '';
  if (!hasParams && !hasType) return { isValid: true, updateData: {} };

  const stored = await prisma.datasets.findUnique({
    where: { id },
    select: { task_type: true, task_type_parameters: true },
  });
  const storedParams = stored?.task_type_parameters;
  const result = validateTaskTypeParams(
    hasType ? (data.task_type as string) : (stored?.task_type ?? DEFAULT_TASK_TYPE),
    hasParams ? data.task_type_parameters : storedParams,
  );
  if (!result.isValid) {
    return { isValid: false, response: apiError({ message: result.message, status: 400 }) };
  }
  if (!hasParams && !isEmptyTaskTypeParams(storedParams)) return { isValid: true, updateData: {} };
  if (!canUpdate('task_type_parameters')) return deniedField('task_type_parameters');
  return { isValid: true, updateData: { task_type_parameters: result.params } };
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('dataset:update');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = (await req.json()) as Record<string, unknown>;
    const access = getFieldAccess('datasets', await getPermissions());
    const canUpdate = (field: string): boolean => access[field]?.canUpdate === true;

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
       const directFields = buildDirectFields(data, canUpdate);
       if (!directFields.isValid) return directFields.response;
       const taskTypeParams = await buildTaskTypeParamsUpdate(data, id, canUpdate);
       if (!taskTypeParams.isValid) return taskTypeParams.response;
       await prisma.datasets.update({ where: { id }, data: { ...directFields.updateData, ...taskTypeParams.updateData } });
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
