'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { cloneDatasetRecords } from '@/lib/dataset-cloning';
import type { Prisma } from '@prisma/client';

export async function getDataset(id: number): Promise<Prisma.datasetsGetPayload<{ include: { testcases: { orderBy: { codename: 'asc' } }; managers: true; tasks_datasets_task_idTotasks: true } }> | null> {
  await ensurePermission('dataset:read');
  return prisma.datasets.findUnique({
    where: { id },
    include: {
      testcases: { orderBy: { codename: 'asc' } },
      managers: true,
      tasks_datasets_task_idTotasks: true,
    },
  });
}

export async function createDataset(
  taskId: number,
  data: { description: string; time_limit?: number; memory_limit?: number; task_type?: string; score_type?: string }
): Promise<{ success: boolean; dataset?: Prisma.datasetsGetPayload<Record<string, never>>; error?: string }> {
  await ensurePermission('dataset:create');
  try {
    const effectivePermissions = await getPermissions();
    const allowed = stripDisallowedFields('datasets', {
      description: data.description,
      time_limit: data.time_limit ?? null,
      memory_limit: data.memory_limit ?? null,
      task_type: data.task_type ?? null,
      score_type: data.score_type ?? null,
    }, effectivePermissions);

    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: (allowed.description as string) ?? data.description,
        time_limit: allowed.time_limit !== undefined ? (allowed.time_limit as number | null) : null,
        memory_limit: allowed.memory_limit !== undefined && allowed.memory_limit
          ? BigInt((allowed.memory_limit as number) * 1024 * 1024) : null,
        task_type: (allowed.task_type as string) ?? 'Batch',
        task_type_parameters: [],
        score_type: (allowed.score_type as string) ?? 'Sum',
        score_type_parameters: [],
        autojudge: false,
      },
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, dataset };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function cloneDataset(datasetId: number, newDescription: string): Promise<{ success: boolean; dataset?: Prisma.datasetsGetPayload<Record<string, never>>; error?: string }> {
  await ensurePermission('dataset:create');
  try {
    const original = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: { testcases: true, managers: true },
    });
    if (!original) return { success: false, error: 'Dataset not found' };
    const newDataset = await cloneDatasetRecords(original, newDescription);
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true, dataset: newDataset };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function renameDataset(datasetId: number, description: string): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('dataset:update');
  try {
    const effectivePermissions = await getPermissions();
    const allowed = stripDisallowedFields('datasets', { description }, effectivePermissions);
    if (!('description' in allowed)) {
      return { success: false, error: 'Permission denied for description field' };
    }

    await prisma.datasets.update({ where: { id: datasetId }, data: { description: allowed.description as string } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteDataset(datasetId: number): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('dataset:delete');
  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: { tasks_datasets_task_idTotasks: true },
    });
    if (dataset?.tasks_datasets_task_idTotasks?.active_dataset_id === datasetId) {
      return { success: false, error: 'Cannot delete the active dataset' };
    }
    await prisma.datasets.delete({ where: { id: datasetId } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function activateDataset(datasetId: number): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('dataset:switch');
  try {
    const dataset = await prisma.datasets.findUnique({ where: { id: datasetId } });
    if (!dataset) return { success: false, error: 'Dataset not found' };
    await prisma.tasks.update({ where: { id: dataset.task_id }, data: { active_dataset_id: datasetId } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function toggleAutojudge(datasetId: number): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('dataset:update');
  try {
    const effectivePermissions = await getPermissions();
    const allowed = stripDisallowedFields('datasets', { autojudge: true }, effectivePermissions);
    if (!('autojudge' in allowed)) {
      return { success: false, error: 'Permission denied for autojudge field' };
    }

    const dataset = await prisma.datasets.findUnique({ where: { id: datasetId } });
    if (!dataset) return { success: false, error: 'Dataset not found' };
    await prisma.datasets.update({ where: { id: datasetId }, data: { autojudge: !dataset.autojudge } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateDataset(
  datasetId: number,
  data: { time_limit?: number | null; memory_limit?: number | null; task_type?: string; score_type?: string }
): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('dataset:update');
  try {
    const effectivePermissions = await getPermissions();
    const allowed = stripDisallowedFields('datasets', data as Record<string, unknown>, effectivePermissions);

    const updateData: Record<string, unknown> = {};
    if ('time_limit' in allowed) updateData.time_limit = allowed.time_limit;
    if ('memory_limit' in allowed) {
      updateData.memory_limit = allowed.memory_limit ? BigInt((allowed.memory_limit as number) * 1024 * 1024) : null;
    }
    if ('task_type' in allowed) updateData.task_type = allowed.task_type;
    if ('score_type' in allowed) updateData.score_type = allowed.score_type;

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'No permitted fields to update' };
    }

    await prisma.datasets.update({ where: { id: datasetId }, data: updateData as Prisma.datasetsUpdateInput });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
