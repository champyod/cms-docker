import { revalidatePath } from 'next/cache';
import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { resolveTeamIdByCode } from '@/lib/teams';
import type { BatchActionRequest } from './credentialActions';
import { recordAudit } from '@/lib/audit';

const CONTEST_MODES = ['add', 'remove'] as const;
const TEAM_MODES = ['set', 'remove-any'] as const;

function revalidateUserContestPages(): void {
  revalidatePath('/[locale]/users', 'page');
  revalidatePath('/[locale]/contests', 'page');
}

function coerceNumber(value: unknown): number {
  return Number(value);
}

function isValidId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

async function addUsersToContest(contestId: number, userIds: number[]): Promise<number> {
  let addedCount = 0;

  for (const userId of userIds) {
    const inserted = await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
      ON CONFLICT (contest_id, user_id) DO NOTHING
    `;
    if (inserted > 0) addedCount += 1;
  }

  return addedCount;
}

export async function handleContest({ body, userIds }: BatchActionRequest): Promise<NextResponse> {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = CONTEST_MODES.find((candidate) => candidate === body.mode);
  const contestId = coerceNumber(body.contestId);

  if (!mode) {
    return apiError({ message: 'Invalid contest mode', status: 400 });
  }

  if (!isValidId(contestId)) {
    return apiError({ message: 'Invalid contestId', status: 400 });
  }

  if (mode === 'add') {
    // WHY participation:create: this inserts participations rows.
    const { authorized, response } = await verifyApiPermission('participation:create');
    if (!authorized) return response;

    const addedCount = await addUsersToContest(contestId, userIds);
    await recordAudit({
      verb: 'participation:create',
      entity: 'contest',
      entityId: String(contestId),
      afterValues: { action: 'batch-contest-add', contestId, userIds, addedCount },
      result: 'success',
    });
    revalidateUserContestPages();
    return apiSuccess({ success: true, addedCount, removedCount: 0 });
  }

  // WHY participation:delete: this removes participations rows.
  const { authorized, response } = await verifyApiPermission('participation:delete');
  if (!authorized) return response;

  const removed = await prisma.participations.deleteMany({
    where: {
      contest_id: contestId,
      user_id: { in: userIds },
    },
  });

  await recordAudit({
    verb: 'participation:delete',
    entity: 'contest',
    entityId: String(contestId),
    afterValues: { action: 'batch-contest-remove', contestId, userIds, removedCount: removed.count },
    result: 'success',
  });
  revalidateUserContestPages();
  return apiSuccess({ success: true, addedCount: 0, removedCount: removed.count });
}

async function assignTeamToUsers(contestId: number, teamId: number, userIds: number[]): Promise<number> {
  let updatedCount = 0;
  for (const userId of userIds) {
    const affected = await prisma.$executeRaw`
      INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
      ON CONFLICT (contest_id, user_id) DO UPDATE
      SET team_id = EXCLUDED.team_id
    `;
    if (affected > 0) updatedCount += 1;
  }

  return updatedCount;
}

async function removeUsersFromAnyTeam(userIds: number[]): Promise<number> {
  const cleared = await prisma.participations.updateMany({
    where: {
      user_id: { in: userIds },
      team_id: { not: null },
    },
    data: {
      team_id: null,
    },
  });

  return cleared.count;
}

async function assignTeamByCode(
  body: Record<string, unknown>,
  userIds: number[]
): Promise<NextResponse> {
  const contestId = coerceNumber(body.contestId);
  const teamCode = String(body.teamCode || '').trim();

  if (!isValidId(contestId)) {
    return apiError({ message: 'Invalid contestId', status: 400 });
  }

  if (!teamCode) {
    return apiError({ message: 'teamCode is required', status: 400 });
  }

  const teamId = await resolveTeamIdByCode(teamCode);
  const updatedCount = await assignTeamToUsers(contestId, teamId, userIds);

  await recordAudit({
    verb: 'participation:update',
    entity: 'team',
    entityId: String(teamId),
    afterValues: { action: 'batch-team-set', contestId, teamCode, teamId, userIds, updatedCount },
    result: 'success',
  });
  revalidateUserContestPages();
  return apiSuccess({ success: true, updatedCount, teamId, teamCode });
}

export async function handleTeam({ body, userIds }: BatchActionRequest): Promise<NextResponse> {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = TEAM_MODES.find((candidate) => candidate === body.mode);

  if (!mode) {
    return apiError({ message: 'Invalid team mode', status: 400 });
  }

  // WHY participation:update: both modes write participations.team_id, so the
  // table being written decides the permission, not the wording of the action.
  const { authorized, response } = await verifyApiPermission('participation:update');
  if (!authorized) return response;

  if (mode === 'remove-any') {
    const updatedCount = await removeUsersFromAnyTeam(userIds);
    await recordAudit({
      verb: 'participation:update',
      entity: 'team',
      afterValues: { action: 'batch-team-remove-any', userIds, updatedCount },
      result: 'success',
    });
    revalidateUserContestPages();
    return apiSuccess({ success: true, updatedCount });
  }

  return assignTeamByCode(body, userIds);
}