'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { validateContestData } from '@/lib/contest-validation';
import {
  executeContestUpdate,
  buildContestInsertDefaults,
  insertContestRow,
  mapContestDbError,
  fetchContestsPage,
} from '@/lib/contests-repo';

export type { ContestData } from '@/lib/contests-repo';
import type { ContestData } from '@/lib/contests-repo';

export async function getContests({ page = 1, search = '' }: { page?: number; search?: string }) {
  await ensurePermission('contests');
  return fetchContestsPage({ page, search });
}

export async function createContest(data: ContestData) {
  await ensurePermission('contests');

  const validation = validateContestData(data);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, error: 'Validation failed' };
  }

  try {
    await insertContestRow(data, buildContestInsertDefaults(data));

    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return mapContestDbError(error);
  }
}

export async function updateContest(id: number, data: Partial<ContestData>) {
  await ensurePermission('contests');

  const validation = validateContestData(data as ContestData, true);
  if (!validation.valid) {
    return { success: false, errors: validation.errors, error: 'Validation failed' };
  }

  try {
    await executeContestUpdate(id, data);

    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return mapContestDbError(error);
  }
}

export async function deleteContest(id: number) {
  await ensurePermission('contests');

  try {
    await prisma.contests.delete({
      where: { id },
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function addParticipant(contestId: number, userId: number) {
  await ensurePermission('contests');

  try {
    await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
    `;
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function removeParticipant(participationId: number) {
  await ensurePermission('contests');

  try {
    await prisma.participations.delete({
      where: { id: participationId },
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function addTaskToContest(contestId: number, taskId: number) {
  await ensurePermission('contests');

  try {
    await prisma.tasks.update({
      where: { id: taskId },
      data: { contest_id: contestId }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeTaskFromContest(taskId: number) {
  await ensurePermission('contests');

  try {
    await prisma.tasks.update({
      where: { id: taskId },
      data: { contest_id: null }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateContestSettings(id: number, data: Partial<ContestData>) {
  return updateContest(id, data);
}

export async function getAvailableContests() {
  await ensurePermission('contests');
  try {
    const contests = await prisma.contests.findMany({
      select: {
        id: true,
        name: true,
        is_active: true,
      },
      orderBy: { id: 'asc' },
    });
    return { success: true, contests };
  } catch (error) {
    return { success: false, contests: [], error: (error as Error).message };
  }
}

export async function activateContest(id: number) {
  await ensurePermission('contests');
  try {
    // Atomic UPDATE — no race window between setting active and clearing others
    await prisma.$executeRaw`
      UPDATE contests SET is_active = (id = ${id})
    `;
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getActiveContest() {
  await ensurePermission('contests');
  try {
    const contest = await prisma.contests.findFirst({
      where: { is_active: true },
      include: {
        _count: { select: { participations: true } },
      },
    });
    return { success: true, contest };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
