'use server';

import { revalidatePath } from 'next/cache';

import { rotateContestAccounts as rotateAccounts, type RotateAccountsResult } from '@/lib/panel-actions';
import { requirePanelActorId } from '@/lib/panel-actor';
import { ensurePermission } from '@/lib/permissions';

/**
 * The day-2 action: rotate a contest's display usernames and set a team for the same accounts.
 *
 * WHY this is a thin wrapper over `panel-actions/contest-accounts`: the rotation is one write over
 * the contest's aliases and its participations, so the SQL and the rules belong to the shared
 * module both the panel and any script-side caller reach. This file adds only what a panel request
 * owns — the permission gates, the session actor and the screen refresh.
 *
 * WHY the team gate is separate from the username gate: the action writes two columns, so it needs
 * both the permission that owns a display username and the one that owns a participation's team; a
 * caller that may only rename accounts must not be able to move them between teams through the
 * same button.
 */

export interface RotateAccountsActionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly rotated?: number;
  readonly assigned?: number;
}

export async function rotateContestAccounts(
  contestId: number,
  userIds: readonly number[],
  teamId: number | null,
  reason: string,
): Promise<RotateAccountsActionResult & Partial<RotateAccountsResult>> {
  await ensurePermission('username:set');
  if (teamId !== null) await ensurePermission('participation:update');

  try {
    const actorId = await requirePanelActorId();
    const result = await rotateAccounts(actorId, { contestId, userIds, teamId, reason });
    revalidatePath('/[locale]/people/users', 'page');
    revalidatePath('/[locale]/contests', 'page');
    return { success: true, rotated: result.rotated, assigned: result.assigned };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'The rotation was refused' };
  }
}
