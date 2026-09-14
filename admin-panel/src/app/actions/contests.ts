'use server'

import { revalidatePath } from 'next/cache';
import * as contestService from '@/lib/services/contests';
import type { ContestData } from '@/lib/contests-repo';

export type { ContestData } from '@/lib/contests-repo';

export async function getContests({ page = 1, search = '' }: { page?: number; search?: string }): Promise<Awaited<ReturnType<typeof contestService.listContests>>> {
  return contestService.listContests({ page, search });
}

export async function createContest(data: ContestData): Promise<Awaited<ReturnType<typeof contestService.createContest>>> {
  const result = await contestService.createContest(data);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function updateContest(id: number, data: Partial<ContestData>): Promise<Awaited<ReturnType<typeof contestService.updateContest>>> {
  const result = await contestService.updateContest(id, data);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function deleteContest(id: number): Promise<Awaited<ReturnType<typeof contestService.deleteContest>>> {
  const result = await contestService.deleteContest(id);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function addParticipant(contestId: number, userId: number): Promise<Awaited<ReturnType<typeof contestService.addParticipant>>> {
  const result = await contestService.addParticipant(contestId, userId);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function removeParticipant(participationId: number): Promise<Awaited<ReturnType<typeof contestService.removeParticipant>>> {
  const result = await contestService.removeParticipant(participationId);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function addTaskToContest(contestId: number, taskId: number): Promise<Awaited<ReturnType<typeof contestService.addTaskToContest>>> {
  const result = await contestService.addTaskToContest(contestId, taskId);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function removeTaskFromContest(taskId: number): Promise<Awaited<ReturnType<typeof contestService.removeTaskFromContest>>> {
  const result = await contestService.removeTaskFromContest(taskId);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function updateContestSettings(id: number, data: Partial<ContestData>): Promise<Awaited<ReturnType<typeof contestService.updateContestSettings>>> {
  const result = await contestService.updateContestSettings(id, data);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function getAvailableContests(): Promise<Awaited<ReturnType<typeof contestService.getAvailableContests>>> {
  return contestService.getAvailableContests();
}

export async function activateContest(id: number): Promise<Awaited<ReturnType<typeof contestService.activateContest>>> {
  const result = await contestService.activateContest(id);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

export async function getActiveContest(): Promise<Awaited<ReturnType<typeof contestService.getActiveContest>>> {
  return contestService.getActiveContest();
}
