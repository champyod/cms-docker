'use server';

import { revalidatePath } from 'next/cache';
import * as taskService from '@/lib/services/tasks';

export type { TaskData, TaskDiagnostic } from '@/lib/services/tasks';

export async function getTasks(params: { page?: number; search?: string } = {}): Promise<Awaited<ReturnType<typeof taskService.listTasks>>> {
  return taskService.listTasks(params);
}

export async function getTask(id: number): Promise<Awaited<ReturnType<typeof taskService.getTask>>> {
  return taskService.getTask(id);
}

export async function getTaskDiagnostics(taskId: number): Promise<Awaited<ReturnType<typeof taskService.getTaskDiagnostics>>> {
  return taskService.getTaskDiagnostics(taskId);
}

export async function createTask(data: Parameters<typeof taskService.createTask>[0]): Promise<Awaited<ReturnType<typeof taskService.createTask>>> {
  const result = await taskService.createTask(data);
  if (result.success) revalidatePath('/[locale]/tasks', 'page');
  return result;
}

export async function updateTask(id: number, data: Parameters<typeof taskService.updateTask>[1]): Promise<Awaited<ReturnType<typeof taskService.updateTask>>> {
  const result = await taskService.updateTask(id, data);
  if (result.success) revalidatePath('/[locale]/tasks', 'page');
  return result;
}

export async function deleteTask(id: number): Promise<Awaited<ReturnType<typeof taskService.deleteTask>>> {
  const result = await taskService.deleteTask(id);
  if (result.success) revalidatePath('/[locale]/tasks', 'page');
  return result;
}

export async function assignTaskToContest(taskId: number, contestId: number | null): Promise<Awaited<ReturnType<typeof taskService.assignTaskToContest>>> {
  const result = await taskService.assignTaskToContest(taskId, contestId);
  if (result.success) {
    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath('/[locale]/contests', 'page');
  }
  return result;
}
