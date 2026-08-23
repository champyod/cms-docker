import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess } from '@/lib/api-utils';
import type { BatchActionRequest } from './credentialActions';

const CONTEST_MODES = ['add', 'remove'] as const;
const TEAM_MODES = ['set', 'remove-any'] as const;

function revalidateUserContestPages(): void {
  revalidatePath('/[locale]/users', 'page');
  revalidatePath('/[locale]/contests', 'page');
}

function parsePositiveInteger(value: unknown): number {
  return Number(value);
}

function isValidId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

export async function handleContest({ body, userIds }: BatchActionRequest) {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = CONTEST_MODES.find((candidate) => candidate === body.mode);
  const contestId = parsePositiveInteger(body.contestId);

  if (!mode) {
    return apiError({ message: 'Invalid contest mode', status: 400 });
  }

  if (!isValidId(contestId)) {
    return apiError({ message: 'Invalid contestId', status: 400 });
  }

  if (mode === 'add') {
    let addedCount = 0;

    for (const userId of userIds) {
      const inserted = await prisma.$executeRaw`
        INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
        VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
        ON CONFLICT (contest_id, user_id) DO NOTHING
      `;
      if (inserted > 0) addedCount += 1;
    }

    revalidateUserContestPages();
    return apiSuccess({ success: true, addedCount, removedCount: 0 });
  }

  const removed = await prisma.participations.deleteMany({
    where: {
      contest_id: contestId,
      user_id: { in: userIds },
    },
  });

  revalidateUserContestPages();
  return apiSuccess({ success: true, addedCount: 0, removedCount: removed.count });
}

async function resolveTeamId(teamCode: string): Promise<number> {
  const existingTeam = await prisma.teams.findUnique({
    where: { code: teamCode },
    select: { id: true },
  });

  if (existingTeam) return existingTeam.id;

  const created = await prisma.teams.create({ data: { code: teamCode, name: teamCode }, select: { id: true } });
  return created.id;
}

export async function handleTeam({ body, userIds }: BatchActionRequest) {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = TEAM_MODES.find((candidate) => candidate === body.mode);

  if (!mode) {
    return apiError({ message: 'Invalid team mode', status: 400 });
  }

  if (mode === 'remove-any') {
    const cleared = await prisma.participations.updateMany({
      where: {
        user_id: { in: userIds },
        team_id: { not: null },
      },
      data: {
        team_id: null,
      },
    });

    revalidateUserContestPages();
    return apiSuccess({ success: true, updatedCount: cleared.count });
  }

  const contestId = parsePositiveInteger(body.contestId);
  const teamCode = String(body.teamCode || '').trim();

  if (!isValidId(contestId)) {
    return apiError({ message: 'Invalid contestId', status: 400 });
  }

  if (!teamCode) {
    return apiError({ message: 'teamCode is required', status: 400 });
  }

  const teamId = await resolveTeamId(teamCode);

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

  revalidateUserContestPages();
  return apiSuccess({ success: true, updatedCount, teamId, teamCode });
}
