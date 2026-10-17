import type { Prisma } from '@prisma/client';

import { recordAudit } from '@/lib/audit';
import { MAX_USERNAME_GENERATION_ATTEMPTS, makeUsername } from '@/lib/credential-generation';
import { prisma } from '@/lib/prisma';
import { resyncRankingUsers } from '@/lib/ranking-projection';

/**
 * The day-2 write: rotate a contest's display usernames and set the team of the same accounts, as
 * one audited action.
 *
 * WHY one module and not a second write beside the panel's: the panel already writes a contest
 * username (the contest-username route) and a participation's team (the enrollment and team-member
 * paths), so the batch has to reach those same columns through the same SQL or the two drift —
 * the day-2 roster would be named by rules the single-row editor does not apply. The upsert, the
 * history append and the participation write therefore live here once, and both the single-row
 * boundaries and this batch call them.
 *
 * WHY one transaction: a rotation that renamed half a roster and then failed would leave the
 * contest with two naming schemes and no way to tell which accounts were done, so the usernames,
 * their history rows and the team assignment commit together or not at all.
 *
 * WHY the refusals are named and not skips: a selected account that is not participating in the
 * contest, a team that does not exist and a contest the panel cannot read are all targets the
 * caller named and this cannot reach — quietly dropping them would report a rotation that never
 * happened for those rows, which is exactly the silent skip the panel refuses.
 */

/** One account's display username, as the single-row route and this batch both write it. */
export interface ContestUsernameWrite {
  readonly contestId: number;
  readonly userId: number;
  readonly participationId: number;
  /** The alias to store, or null to clear it. */
  readonly username: string | null;
  readonly adminId: number;
}

/** The accounts to rotate and the team to set on them, as the panel states the day-2 action. */
export interface RotateAccountsInput {
  readonly contestId: number;
  readonly userIds: readonly number[];
  /** The team to set on every selected participation, or null to leave the team alone. */
  readonly teamId: number | null;
  readonly reason: string;
}

export interface RotateAccountsResult {
  /** How many accounts got a fresh username. */
  readonly rotated: number;
  /** How many participations took the team, or zero when no team was named. */
  readonly assigned: number;
}

/**
 * Stores one contest display username and appends its history row.
 *
 * WHY the history append is not optional: the panel's route already records every alias change, so
 * a batch that skipped it would leave the day-2 rotation invisible in exactly the place an operator
 * looks for "what was this account called before".
 */
export async function writeContestUsername(
  client: Prisma.TransactionClient,
  entry: ContestUsernameWrite,
): Promise<void> {
  const { contestId, userId, participationId, username, adminId } = entry;
  if (username === null) {
    await client.$executeRaw`
      DELETE FROM contest_usernames
      WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  } else {
    await client.$executeRaw`
      INSERT INTO contest_usernames (participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id)
      VALUES (${participationId}, ${contestId}, ${userId}, ${username}, now(), ${adminId})
      ON CONFLICT (participation_id) DO UPDATE
        SET username = EXCLUDED.username,
            updated_at = EXCLUDED.updated_at,
            updated_by_admin_id = EXCLUDED.updated_by_admin_id`;
  }
  await client.$executeRaw`
    INSERT INTO contest_usernames_history (contest_id, user_id, username, set_at, set_by_admin_id)
    VALUES (${contestId}, ${userId}, ${username}, now(), ${adminId})`;
}

/**
 * Sets one team on a set of participations, inserting the participation when it is missing.
 *
 * WHY the upsert and not a plain update: the enrollment and team-member paths already create a
 * participation when one is absent, so an assignment that updated only existing rows would mean
 * two different outcomes for the same operator intent depending on which surface ran it.
 *
 * returns: how many rows the write actually touched, so a caller can tell a no-op from a write.
 */
export async function assignTeamToParticipants(
  client: Prisma.TransactionClient,
  contestId: number,
  teamId: number,
  userIds: readonly number[],
): Promise<number> {
  let assigned = 0;
  for (const userId of userIds) {
    const affected = await client.$executeRaw`
      INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
      VALUES (${contestId}, ${userId}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
      ON CONFLICT (contest_id, user_id) DO UPDATE
      SET team_id = EXCLUDED.team_id`;
    if (affected > 0) assigned += 1;
  }
  return assigned;
}

function readContestId(raw: number): number {
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`not a contest id: ${String(raw)}`);
  }
  return raw;
}

function readUserIds(raw: readonly number[]): number[] {
  const refused = raw.filter((id) => !Number.isInteger(id) || id <= 0);
  if (refused.length > 0) throw new Error(`not an account id: ${refused.join(', ')}`);
  if (raw.length === 0) throw new Error('select at least one account to rotate');
  return [...new Set(raw)];
}

/** The first generated alias that is already a login username, or null when none is. */
async function firstLoginClash(names: readonly string[]): Promise<string | null> {
  const [users, admins] = await Promise.all([
    prisma.users.findMany({ where: { username: { in: [...names] } }, select: { username: true } }),
    prisma.admins.findMany({ where: { username: { in: [...names] } }, select: { username: true } }),
  ]);
  const found = [...users, ...admins].map((row) => row.username);
  return found.length > 0 ? found[0] : null;
}

interface RotationPlan {
  readonly username: string;
  readonly userId: number;
  readonly participationId: number;
}

/**
 * Plans one fresh, free alias per account before anything is written.
 *
 * WHY the plan is built before the transaction: generation reads the aliases already in the contest
 * and the login names, and doing that inside the write would hold the transaction open across reads
 * it does not need to. WHY the whole plan is refused when any alias collides with a login name: a
 * display alias that is also a login name makes the contest's own login ambiguous, and the route
 * already refuses it for one account — refusing the batch keeps that rule in one place.
 */
async function planRotation(contestId: number, userIds: readonly number[]): Promise<RotationPlan[]> {
  const [users, participations, taken] = await Promise.all([
    prisma.users.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, first_name: true, last_name: true },
    }),
    prisma.participations.findMany({
      where: { contest_id: contestId, user_id: { in: [...userIds] } },
      select: { id: true, user_id: true },
    }),
    prisma.contest_usernames.findMany({
      where: { contest_id: contestId },
      select: { username: true },
    }),
  ]);

  const byUser = new Map(users.map((user) => [user.id, user]));
  const participationByUser = new Map(participations.map((row) => [row.user_id, row.id]));
  const missing = userIds.filter((id) => !byUser.has(id) || !participationByUser.has(id));
  if (missing.length > 0) {
    throw new Error(`not participating in contest ${contestId}: ${missing.join(', ')}`);
  }

  const used = new Set(taken.map((row) => row.username));
  const plan: RotationPlan[] = [];
  const generated: string[] = [];
  for (const userId of userIds) {
    const user = byUser.get(userId);
    if (user === undefined) throw new Error(`no user with id ${userId}`);
    let candidate = '';
    for (let attempt = 0; attempt < MAX_USERNAME_GENERATION_ATTEMPTS; attempt += 1) {
      const next = makeUsername(user.first_name, user.last_name);
      if (!used.has(next)) {
        candidate = next;
        break;
      }
    }
    if (candidate === '') {
      throw new Error(`could not find a free username for account ${userId}`);
    }
    used.add(candidate);
    generated.push(candidate);
    plan.push({ username: candidate, userId, participationId: participationByUser.get(userId) as number });
  }

  const clash = await firstLoginClash(generated);
  if (clash !== null) throw new Error(`${clash} is already a login username`);
  return plan;
}

/**
 * Rotates a contest's display usernames and sets the team of the same accounts, in one transaction.
 *
 * WHY the team write is part of this action and not a second step: the operator's day-2 work was a
 * rotation and a team assignment for the same roster, and running them as two writes leaves a
 * window where the roster is named for day two but still sits on the old team. One transaction
 * means the roster is either wholly day-two or wholly untouched.
 *
 * returns: how many accounts were renamed and how many took the team, so the caller can state the
 * result count instead of reporting success for a batch that changed nothing.
 */
export async function rotateContestAccounts(
  actorId: number,
  input: RotateAccountsInput,
): Promise<RotateAccountsResult> {
  const reason = input.reason.trim();
  if (reason === '') throw new Error("rotating a contest's accounts needs a reason");
  const contestId = readContestId(input.contestId);
  const userIds = readUserIds(input.userIds);
  if (input.teamId !== null && (!Number.isInteger(input.teamId) || input.teamId <= 0)) {
    throw new Error(`not a team id: ${String(input.teamId)}`);
  }

  const contest = await prisma.contests.findUnique({ where: { id: contestId }, select: { id: true } });
  if (contest === null) throw new Error(`no contest with id ${contestId} to rotate its accounts`);

  if (input.teamId !== null) {
    const team = await prisma.teams.findUnique({ where: { id: input.teamId }, select: { id: true } });
    if (team === null) throw new Error(`no team with id ${input.teamId} to assign`);
  }

  const plan = await planRotation(contestId, userIds);
  const teamId = input.teamId;

  const assigned = await prisma.$transaction(async (tx) => {
    for (const entry of plan) {
      await writeContestUsername(tx, {
        contestId,
        userId: entry.userId,
        participationId: entry.participationId,
        username: entry.username,
        adminId: actorId,
      });
    }
    if (teamId === null) return 0;
    return assignTeamToParticipants(tx, contestId, teamId, plan.map((entry) => entry.userId));
  });

  for (const entry of plan) {
    await recordAudit({
      actorId,
      verb: 'contest_username:set',
      entity: 'contest_username',
      entityId: `${contestId}:${entry.userId}`,
      afterValues: { username: entry.username, rotated: true },
      reason,
      result: 'success',
    });
  }
  if (teamId !== null) {
    await recordAudit({
      actorId,
      verb: 'participation:update',
      entity: 'team',
      entityId: String(teamId),
      afterValues: {
        action: 'contest-account-rotate-team',
        contestId,
        teamId,
        userIds: plan.map((entry) => entry.userId),
        assigned,
      },
      reason,
      result: 'success',
    });
  }

  await resyncRankingUsers(contestId);
  return { rotated: plan.length, assigned };
}
