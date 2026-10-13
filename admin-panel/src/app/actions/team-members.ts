'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { recordAudit } from '@/lib/audit';
import {
  executeBulkParticipationSettings,
  parseIpAllowlist,
  type BulkParticipationSettings,
} from './participation-sql';
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

    let added = 0;
    for (const user of users) {
      const affected = await prisma.$executeRaw`
        INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
        VALUES (${contestId}, ${user.id}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
        ON CONFLICT (contest_id, user_id) DO UPDATE
        SET team_id = EXCLUDED.team_id
      `;
      if (affected > 0) added += 1;
    }

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
): Promise<ActionResult & { updated?: number }> {
  await ensurePermission('participation:update');

  try {
    if (userIds.length === 0) {
      return { success: false, error: 'No members selected' };
    }

    const permissions = await getPermissions();
    const allowed = stripDisallowedFields(
      'participations',
      settings as Record<string, unknown>,
      permissions,
    ) as BulkParticipationSettings;

    const { validIps, error } = parseIpAllowlist(allowed.ip);
    if (error) return { success: false, error };

    const rows = await prisma.participations.findMany({
      where: { contest_id: contestId, user_id: { in: [...userIds] } },
      select: { id: true },
    });
    const participationIds = rows.map((row) => row.id);
    await executeBulkParticipationSettings(participationIds, allowed, validIps);

    await resyncRankingUsers(contestId);
    await recordAudit({
      verb: 'participation:update',
      entity: 'contest',
      entityId: String(contestId),
      afterValues: { action: 'team-bulk-settings', contestId, participationIds, settings: allowed, ip: validIps },
      result: 'success',
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true, updated: participationIds.length };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
