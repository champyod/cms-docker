import { prisma } from '@/lib/prisma';
import { loadShownContestIds } from '@/lib/ranking-config-store';

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

/**
 * The spellings a target key may hold in the projection.
 *
 * WHY both: the panel writes a user or team key as the operator sees it, while the projection keys
 * its rows with the encoded form ProxyService pushes (encodeId). Reading both means a reader
 * reports the row that exists whichever spelling the operator's row carries, instead of silently
 * answering "nothing" for a key the projection stores encoded.
 */
export function keySpellings(key: string): string[] {
  return [...new Set([key, encodeId(key)])];
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
 * Mirrors ProxyService.initialize() for a shown contest: re-pushes its non-hidden
 * participants into the ranking projection and drops every other user key, so a
 * participant added, edited or removed through the panel reaches the ranking without a
 * proxy reinitialize. Only a contest the config shows is touched, because the config —
 * not `contests.is_active` — is what the reader draws, so editing an unshown contest's
 * participations cannot empty a board the operator is showing.
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
    const shown = await loadShownContestIds();
    if (!shown.has(contestId)) return;

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
 * Resyncs every contest the board shows; for callers with no single contest id. Best-effort like
 * `resyncRankingUsers`: a database read that fails must not fail the change that triggered it.
 *
 * WHY the shown set and not the active contest: `contests.is_active` is the deployment default
 * the reader no longer draws from, so resyncing it would refresh a board nobody is showing while
 * leaving the shown one stale — the divergence this scoping exists to end.
 */
export async function resyncShownRankingUsers(): Promise<void> {
  let shown: Set<number>;
  try {
    shown = await loadShownContestIds();
  } catch (error) {
    console.error('Failed to read the shown set for the ranking users projection:', error);
    return;
  }
  for (const contestId of shown) {
    await resyncRankingUsers(contestId);
  }
}

/**
 * The projected contest row for one contest, derived from the CMS row it mirrors.
 *
 * WHY the panel writes this one and not the tasks: the fields are a straight rename of the
 * `contests` row — the encoded name is the key, the description is the board's name for it, and
 * the two dates become the epoch seconds the projection carries. A task row is different: it
 * carries a max score and extra headers derived from the dataset's score type, which is the
 * proxy's derivation, so re-deriving it here would be a second implementation of the projection
 * and would drift from the first. The row written here is what lets a board draw a contest the
 * moment the config shows it, with the name and dates the operator expects, without waiting for
 * a push.
 *
 * WHY the caller supplies the transaction: the config row and this one have to commit together,
 * or a board briefly draws a contest whose own record does not exist yet.
 *
 * returns: the statements, unrun, for the caller to put in its own transaction.
 */
export async function projectContestStatements(contestId: number): Promise<RankingWrite[]> {
  const contest = await prisma.contests.findUnique({
    where: { id: contestId },
    select: {
      name: true,
      description: true,
      start: true,
      stop: true,
      score_precision: true,
    },
  });
  if (contest === null) {
    throw new Error(`No contest with id ${contestId} to project`);
  }
  return [
    prisma.$executeRaw`
      INSERT INTO ranking_contests (key, name, begin, "end", score_precision, contest_id)
      VALUES (
        ${encodeId(contest.name)},
        ${contest.description},
        ${Math.floor(contest.start.getTime() / 1000)},
        ${Math.floor(contest.stop.getTime() / 1000)},
        ${contest.score_precision},
        ${contestId}
      )
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        begin = EXCLUDED.begin,
        "end" = EXCLUDED."end",
        score_precision = EXCLUDED.score_precision,
        contest_id = EXCLUDED.contest_id,
        updated_at = CURRENT_TIMESTAMP
    `,
  ];
}
