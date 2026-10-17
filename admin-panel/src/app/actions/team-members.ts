'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { assignTeamToParticipants } from '@/lib/panel-actions';
import { type BulkParticipationSettings } from './participation-sql';
import { applyBulkParticipationSettings, type BulkParticipationResult } from './participation-settings';
import { resyncRankingUsers } from '@/lib/ranking-projection';

interface ActionResult {
  success: boolean;
  error?: string;
}

// Why the team-assign path uses participation:update and not participation:create:
// the INSERT ... ON CONFLICT below only ever adds a team to a participation, which
// is what the existing single-user team assignment already gates on.

function revalidateTeamPages(): void {
  revalidatePath('/[locale]/people/teams', 'page');
  revalidatePath('/[locale]/contests', 'page');
}

function cleanUsernames(usernames: readonly string[]): string[] {
  return [...new Set(usernames.map((name) => name.trim()).filter((name) => name.length > 0))];
}

export async function addUsersToTeamByUsername(
  teamId: number,
  contestId: number,
  usernames: readonly string[]
): Promise<ActionResult & { added?: number; missing?: string[] }> {
  await ensurePermission('participation:update');

  try {
    const wanted = cleanUsernames(usernames);
    if (wanted.length === 0) {
      return { success: false, error: 'No usernames provided' };
    }

    const users = await prisma.users.findMany({
      where: { username: { in: wanted } },
      select: { id: true, username: true },
    });
    const found = new Set(users.map((user) => user.username));
    const missing = wanted.filter((name) => !found.has(name));

    const added = await assignTeamToParticipants(prisma, contestId, teamId, users.map((user) => user.id));

    await resyncRankingUsers(contestId);
    await recordAudit({
      verb: 'participation:update',
      entity: 'team',
      entityId: String(teamId),
      afterValues: { action: 'team-bulk-add-users', contestId, usernames: wanted, added, missing },
      result: 'success',
    });
    revalidateTeamPages();
    return { success: true, added, missing };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function applyTeamParticipationSettings(
  contestId: number,
  userIds: readonly number[],
  settings: BulkParticipationSettings
): Promise<BulkParticipationResult> {
  return applyBulkParticipationSettings(contestId, userIds, settings, 'team-bulk-settings');
}
