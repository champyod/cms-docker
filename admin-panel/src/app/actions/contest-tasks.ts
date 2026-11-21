'use server';

import { revalidatePath } from 'next/cache';

import { attachContestTasks as attachTasks, detachContestTasks as detachTasks } from '@/lib/panel-actions';
import { requirePanelActorId } from '@/lib/panel-actor';
import { ensurePermission } from '@/lib/permissions';

/**
 * The contest-task surface's bulk attach and detach.
 *
 * WHY these are thin wrappers over `panel-actions/contest-tasks`: the single-row add/remove on the
 * contest detail tab and this batch have to mean the same thing by "a task is on this contest" —
 * the same next-number rule and the same one-row-per-pair shape — so the membership write lives in
 * the shared module and this adds only the permission, the actor and the refresh.
 */

export interface ContestTasksActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly changed?: number;
}

function revalidateContestTaskPages(): void {
  revalidatePath('/[locale]/contests', 'page');
  revalidatePath('/[locale]/tasks', 'page');
}

export async function attachContestTasks(
  contestId: number,
  taskIds: readonly number[],
): Promise<ContestTasksActionResult> {
  await ensurePermission('task:update');
  try {
    const actorId = await requirePanelActorId();
    const changed = await attachTasks(actorId, { contestId, taskIds });
    revalidateContestTaskPages();
    return { success: true, changed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'The attach was refused' };
  }
}

export async function detachContestTasks(
  contestId: number,
  taskIds: readonly number[],
): Promise<ContestTasksActionResult> {
  await ensurePermission('task:update');
  try {
    const actorId = await requirePanelActorId();
    const changed = await detachTasks(actorId, { contestId, taskIds });
    revalidateContestTaskPages();
    return { success: true, changed };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'The detach was refused' };
  }
}
