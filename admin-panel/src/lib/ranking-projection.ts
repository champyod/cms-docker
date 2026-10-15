import { prisma } from '@/lib/prisma';
import { readActiveContestId } from '@/lib/active-contest';

/**
 * Encodes an entity id the way ProxyService.encode_id does before it reaches the
 * ranking projection: every character outside [A-Za-z0-9] becomes `_<hex codepoint>`.
 * Kept here so a row written by the panel has the same key the proxy would push for
 * the same user or team.
 */
export function encodeId(entityId: string): string {
  let encoded = '';
  for (const character of entityId) {
    encoded += /[A-Za-z0-9]/.test(character)
      ? character
      : `_${character.codePointAt(0)!.toString(16)}`;
  }
  return encoded;
}

/** The participation fields the projection is built from. */
interface ParticipationRow {
  readonly users: { username: string; first_name: string; last_name: string };
  readonly teams: { code: string; name: string } | null;
}

interface ProjectedUser {
  key: string;
  f_name: string;
  l_name: string;
  team: string | null;
}

interface ProjectedTeam {
  key: string;
  name: string;
}

/** A hidden participation as the projection records it: the key to filter, and where. */
interface ProjectedHidden {
  key: string;
  contest_id: number;
}

interface HiddenParticipationRow {
  readonly users: { username: string };
}

type RankingWrite = ReturnType<typeof prisma.$executeRaw>;

function projectUsers(participants: ReadonlyArray<ParticipationRow>): ProjectedUser[] {
  return participants.map((participation) => ({
    key: encodeId(participation.users.username),
    f_name: participation.users.first_name,
    l_name: participation.users.last_name,
    team: participation.teams ? encodeId(participation.teams.code) : null,
  }));
}

/**
 * The hidden participants of one contest as tombstones for the board to filter out.
 *
 * WHY keyed by the encoded username: the primary key is (key, contest_id), so a username
 * listed twice would break the batch rather than be idempotent.
 */
function projectHidden(
  participants: ReadonlyArray<HiddenParticipationRow>,
  contestId: number,
): ProjectedHidden[] {
  const hidden = new Map<string, ProjectedHidden>();
  for (const participation of participants) {
    const key = encodeId(participation.users.username);
    hidden.set(key, { key, contest_id: contestId });
  }
  return [...hidden.values()];
}

/**
 * The distinct teams the participants belong to.
 *
 * WHY the panel writes them: a user row names its team by key, and a board that reads a team
 * it was never told about cannot place the user — the proxy's initialize writes both tables,
 * so the panel mirrors it. Teams are shared across contests, so none is pruned here.
 */
function projectTeams(participants: ReadonlyArray<ParticipationRow>): ProjectedTeam[] {
  const teams = new Map<string, ProjectedTeam>();
  for (const participation of participants) {
    const team = participation.teams;
    if (team === null) continue;
    const key = encodeId(team.code);
    teams.set(key, { key, name: team.name });
  }
  return [...teams.values()];
}

function upsertTeamStatement(team: ProjectedTeam): RankingWrite {
  return prisma.$executeRaw`
    INSERT INTO ranking_teams (key, name)
    VALUES (${team.key}, ${team.name})
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = CURRENT_TIMESTAMP
  `;
}

function upsertUserStatement(user: ProjectedUser): RankingWrite {
  return prisma.$executeRaw`
    INSERT INTO ranking_users (key, f_name, l_name, team)
    VALUES (${user.key}, ${user.f_name}, ${user.l_name}, ${user.team})
    ON CONFLICT (key) DO UPDATE SET
      f_name = EXCLUDED.f_name,
      l_name = EXCLUDED.l_name,
      team = EXCLUDED.team,
      updated_at = CURRENT_TIMESTAMP
  `;
}

function deleteStaleUsersStatement(users: readonly ProjectedUser[]): RankingWrite {
  return prisma.$executeRaw`DELETE FROM ranking_users WHERE key <> ALL(${users.map((user) => user.key)}::text[])`;
}

function upsertHiddenStatement(hidden: ProjectedHidden): RankingWrite {
  return prisma.$executeRaw`
    INSERT INTO ranking_hidden (key, contest_id)
    VALUES (${hidden.key}, ${hidden.contest_id})
    ON CONFLICT (key, contest_id) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
  `;
}

/**
 * Reclaims the tombstones of this contest, whose roster is the whole truth for it: a
 * participation unhidden since the last write has to leave the board again.
 *
 * WHY scoped by contest: tombstones of another contest are that contest's business, and a
 * delete over the whole table would unhide its participants here.
 */
function deleteStaleHiddenStatement(contestId: number, keys: readonly string[]): RankingWrite {
  return prisma.$executeRaw`DELETE FROM ranking_hidden WHERE contest_id = ${contestId} AND key <> ALL(${keys}::text[])`;
}

/**
 * Mirrors ProxyService.initialize() for the ranked contest: re-pushes its non-hidden
 * participants into the ranking projection and drops every other user key, so a
 * participant added, edited or removed through the panel reaches the ranking without a
 * proxy reinitialize. Only the contest the database flags active is touched, so editing
 * another contest's participations cannot empty the projection.
 *
 * The hidden participants of the same contest are mirrored as tombstones, because the
 * board row is driven by the submissions: without one, hiding a participation would leave
 * its row and scores where they were.
 *
 * Best-effort: a failure is logged rather than thrown, because the ranking service
 * unions the submission users and tolerates a stale projection, and a failed refresh
 * must not fail the change that triggered it.
 */
export async function resyncRankingUsers(contestId: number): Promise<void> {
  try {
    const activeContestId = await readActiveContestId();
    if (activeContestId === null || activeContestId !== contestId) return;

    const participants = await prisma.participations.findMany({
      where: { contest_id: contestId, hidden: false },
      select: {
        users: { select: { username: true, first_name: true, last_name: true } },
        teams: { select: { code: true, name: true } },
      },
    });
    const hiddenParticipants = await prisma.participations.findMany({
      where: { contest_id: contestId, hidden: true },
      select: { users: { select: { username: true } } },
    });

    const users = projectUsers(participants);
    const hidden = projectHidden(hiddenParticipants, contestId);
    await prisma.$transaction([
      ...projectTeams(participants).map(upsertTeamStatement),
      ...users.map(upsertUserStatement),
      deleteStaleUsersStatement(users),
      ...hidden.map(upsertHiddenStatement),
      deleteStaleHiddenStatement(contestId, hidden.map((entry) => entry.key)),
    ]);
  } catch (error) {
    console.error('Failed to resync the ranking users projection:', error);
  }
}

/**
 * Resyncs whichever contest the database flags active; for callers with no contest id. Best-effort
 * like `resyncRankingUsers`: a database read that fails must not fail the change that triggered it.
 */
export async function resyncActiveRankingUsers(): Promise<void> {
  let activeContestId: number | null;
  try {
    activeContestId = await readActiveContestId();
  } catch (error) {
    console.error('Failed to read the active contest for the ranking users projection:', error);
    return;
  }
  if (activeContestId === null) return;
  await resyncRankingUsers(activeContestId);
}
