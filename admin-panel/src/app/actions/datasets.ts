'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { cloneDatasetRecords } from '@/lib/dataset-cloning';
import type { Prisma } from '@prisma/client';

export async function getDataset(id: number): Promise<Prisma.datasetsGetPayload<{ include: { testcases: { orderBy: { codename: 'asc' } }; managers: true; tasks_datasets_task_idTotasks: true } }> | null> {
  await ensurePermission('tasks');
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
  await ensurePermission('tasks');
  try {
    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: data.description,
        time_limit: data.time_limit ?? null,
        memory_limit: data.memory_limit ? BigInt(data.memory_limit * 1024 * 1024) : null,
        task_type: data.task_type ?? 'Batch',
        task_type_parameters: [],
        score_type: data.score_type ?? 'Sum',
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
  await ensurePermission('tasks');
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
  await ensurePermission('tasks');
  try {
    await prisma.datasets.update({ where: { id: datasetId }, data: { description } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteDataset(datasetId: number): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('tasks');
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
  await ensurePermission('tasks');
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
  await ensurePermission('tasks');
  try {
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
  await ensurePermission('tasks');
  try {
    await prisma.datasets.update({
      where: { id: datasetId },
      data: {
        ...(data.time_limit !== undefined && { time_limit: data.time_limit }),
        ...(data.memory_limit !== undefined && { memory_limit: data.memory_limit ? BigInt(data.memory_limit * 1024 * 1024) : null }),
        ...(data.task_type && { task_type: data.task_type }),
        ...(data.score_type && { score_type: data.score_type }),
      },
    });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
