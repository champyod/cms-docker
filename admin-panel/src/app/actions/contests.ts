'use server'

import { revalidatePath } from 'next/cache';
import * as contestService from '@/lib/services/contests';
import * as contestDetail from '@/lib/queries/contest-detail';
import type { ContestData } from '@/lib/contests-repo';
import type { ListSortInput } from '@/lib/list-sorting';

export type { ContestData } from '@/lib/contests-repo';

export async function getContests({ page = 1, search = '', sort = null }: { page?: number; search?: string; sort?: ListSortInput }): Promise<Awaited<ReturnType<typeof contestService.listContests>>> {
  return contestService.listContests({ page, search, sort });
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

export async function removeTaskFromContest(contestId: number, taskId: number): Promise<Awaited<ReturnType<typeof contestService.removeTaskFromContest>>> {
  const result = await contestService.removeTaskFromContest(contestId, taskId);
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

export async function getBoundContestId(): Promise<Awaited<ReturnType<typeof contestService.getBoundContestId>>> {
  return contestService.getBoundContestId();
}

export async function activateContest(id: number): Promise<Awaited<ReturnType<typeof contestService.activateContest>>> {
  const result = await contestService.activateContest(id);
  if (result.success) revalidatePath('/[locale]/contests', 'page');
  return result;
}

// Why: on-demand dialog read — the record layout never loads full edit
// fields, so the Edit Contest dialog fetches them through this wrapper.
export async function getContestEditData(id: number): Promise<Awaited<ReturnType<typeof contestDetail.getContestEditData>>> {
  return contestDetail.getContestEditData(id);
}

// Why: the countdown tab polls this to hot-reload timing config edits
// made in Overview or Settings without a manual browser refresh.
export async function getContestCountdown(id: number): Promise<Awaited<ReturnType<typeof contestDetail.getContestCountdown>>> {
  return contestDetail.getContestCountdown(id);
}
