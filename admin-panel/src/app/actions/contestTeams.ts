'use server'

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { ACTION_PERMISSIONS } from '@/lib/permission-engine';
import { recordAudit } from '@/lib/audit';
import { getContestRoster, type ContestRosterRow } from '@/lib/queries/contest-detail';

export type ContestRosterWriteResult = { success: boolean; error?: string };

// Why team:update: a contest_teams row changes which teams registration offers,
// and the team's own flag takes the same key.
const ROSTER_VERB = 'team:update';
const ROSTER_ENTITY = 'team';
const ROSTER_PATH = '/[locale]/contests/[id]/participants';

type RosterKey = { contest_id: number; team_id: number };

function rosterKey(contestId: number, teamId: number): RosterKey {
  return { contest_id: contestId, team_id: teamId };
}

interface RosterMutation {
  before?: () => Promise<unknown>;
  write: () => Promise<unknown>;
  afterValues: unknown;
}

// One place for the write ritual: gate, read the previous row for the log, write,
// audit, then revalidate — so the three roster writes cannot drift apart.
async function runRosterMutation(teamId: number, mutation: RosterMutation): Promise<ContestRosterWriteResult> {
  await ensurePermission(ACTION_PERMISSIONS.updateTeam);
  try {
    const beforeValues = mutation.before ? await mutation.before() : undefined;
    await mutation.write();
    await recordAudit({
      verb: ROSTER_VERB,
      entity: ROSTER_ENTITY,
      entityId: String(teamId),
      beforeValues,
      afterValues: mutation.afterValues,
      result: 'success',
    });
    revalidatePath(ROSTER_PATH, 'page');
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Why the reader owns the gate: this action serves the roster to the tab, and
// getContestRoster is the boundary the page reads through, so a second check
// here could only drift from it.
export async function listContestRoster(contestId: number): Promise<readonly ContestRosterRow[]> {
  return (await getContestRoster(contestId))?.roster ?? [];
}

export async function setContestTeamRegisterable(contestId: number, teamId: number, registerable: boolean): Promise<ContestRosterWriteResult> {
  return runRosterMutation(teamId, {
    before: () => prisma.contest_teams.findUnique({ where: { contest_id_team_id: rosterKey(contestId, teamId) } }),
    write: () => prisma.contest_teams.upsert({
      where: { contest_id_team_id: rosterKey(contestId, teamId) },
      create: { ...rosterKey(contestId, teamId), registerable },
      update: { registerable },
    }),
    afterValues: { ...rosterKey(contestId, teamId), registerable },
  });
}

export async function addTeamToRoster(contestId: number, teamId: number): Promise<ContestRosterWriteResult> {
  return runRosterMutation(teamId, {
    write: () => prisma.contest_teams.create({ data: { ...rosterKey(contestId, teamId), registerable: true } }),
    afterValues: { ...rosterKey(contestId, teamId), registerable: true },
  });
}

export async function removeTeamFromRoster(contestId: number, teamId: number): Promise<ContestRosterWriteResult> {
  return runRosterMutation(teamId, {
    before: () => prisma.contest_teams.findUnique({ where: { contest_id_team_id: rosterKey(contestId, teamId) } }),
    write: () => prisma.contest_teams.delete({ where: { contest_id_team_id: rosterKey(contestId, teamId) } }),
    afterValues: { contest_id: contestId, team_id: null },
  });
}
