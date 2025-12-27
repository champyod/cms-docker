'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get a single dataset with testcases
export async function getDataset(id: number) {
  return prisma.datasets.findUnique({
    where: { id },
    include: {
      testcases: { orderBy: { codename: 'asc' } },
      managers: true,
      tasks_datasets_task_idTotasks: true,
    }
  });
}

// Create a new dataset for a task
export async function createDataset(taskId: number, data: {
  description: string;
  time_limit?: number;
  memory_limit?: number;
  task_type?: string;
  score_type?: string;
}) {
  try {
    const dataset = await prisma.datasets.create({
      data: {
        task_id: taskId,
        description: data.description,
        time_limit: data.time_limit || null,
        memory_limit: data.memory_limit ? BigInt(data.memory_limit * 1024 * 1024) : null,
        task_type: data.task_type || 'Batch',
        task_type_parameters: [],
        score_type: data.score_type || 'Sum',
        score_type_parameters: [],
        autojudge: false,
      }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true, dataset };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Clone an existing dataset
export async function cloneDataset(datasetId: number, newDescription: string) {
  try {
    const original = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: { testcases: true, managers: true }
    });
    
    if (!original) {
      return { success: false, error: 'Dataset not found' };
    }
    
    // Create new dataset with same settings
    const newDataset = await prisma.datasets.create({
      data: {
        task_id: original.task_id,
        description: newDescription,
        time_limit: original.time_limit,
        memory_limit: original.memory_limit,
        task_type: original.task_type,
        task_type_parameters: original.task_type_parameters as any,
        score_type: original.score_type,
        score_type_parameters: original.score_type_parameters as any,
        autojudge: false,
      }
    });
    
    // Copy testcases
    for (const tc of original.testcases) {
      await prisma.testcases.create({
        data: {
          dataset_id: newDataset.id,
          codename: tc.codename,
          public: tc.public,
          input: tc.input,
          output: tc.output,
        }
      });
    }
    
    // Copy managers
    for (const mgr of original.managers) {
      await prisma.managers.create({
        data: {
          dataset_id: newDataset.id,
          filename: mgr.filename,
          digest: mgr.digest,
        }
      });
    }
    
    revalidatePath('/[locale]/tasks');
    return { success: true, dataset: newDataset };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Rename dataset description
export async function renameDataset(datasetId: number, description: string) {
  try {
    await prisma.datasets.update({
      where: { id: datasetId },
      data: { description }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Delete a dataset
export async function deleteDataset(datasetId: number) {
  try {
    // Check if this is the active dataset
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId },
      include: { tasks_datasets_task_idTotasks: true }
    });
    
    if (dataset?.tasks_datasets_task_idTotasks?.active_dataset_id === datasetId) {
      return { success: false, error: 'Cannot delete the active dataset' };
    }
    
    await prisma.datasets.delete({ where: { id: datasetId } });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Activate a dataset (set as active for the task)
export async function activateDataset(datasetId: number) {
  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId }
    });
    
    if (!dataset) {
      return { success: false, error: 'Dataset not found' };
    }
    
    await prisma.tasks.update({
      where: { id: dataset.task_id },
      data: { active_dataset_id: datasetId }
    });
    
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Toggle autojudge for a dataset
export async function toggleAutojudge(datasetId: number) {
  try {
    const dataset = await prisma.datasets.findUnique({
      where: { id: datasetId }
    });
    
    if (!dataset) {
      return { success: false, error: 'Dataset not found' };
    }
    
    await prisma.datasets.update({
      where: { id: datasetId },
      data: { autojudge: !dataset.autojudge }
    });
    
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Update dataset settings
export async function updateDataset(datasetId: number, data: {
  time_limit?: number | null;
  memory_limit?: number | null;
  task_type?: string;
  score_type?: string;
}) {
  try {
    await prisma.datasets.update({
      where: { id: datasetId },
      data: {
        ...(data.time_limit !== undefined && { time_limit: data.time_limit }),
        ...(data.memory_limit !== undefined && { 
          memory_limit: data.memory_limit ? BigInt(data.memory_limit * 1024 * 1024) : null 
        }),
        ...(data.task_type && { task_type: data.task_type }),
        ...(data.score_type && { score_type: data.score_type }),
      }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
