import { prisma } from '@/lib/prisma';
import { encodeId, keySpellings } from '@/lib/ranking-projection';

/**
 * What a pending override does to the board, read from the projection.
 *
 * WHY the projection and not the override row: the operator decides by what the scoreboard will
 * lose, and the scoreboard is drawn from the projection tables, so a row-level set diff answers a
 * question nobody asked. The columns are the board's task columns the row drops, the users the
 * board rows it removes or renames, and the teams the team groupings it hides.
 */
export interface RankingImpact {
  readonly columns: readonly string[];
  readonly users: readonly string[];
  readonly teams: readonly string[];
  /** The key names a contest other than the shard's, so the reader never applies the row. */
  readonly scopeMismatch: boolean;
  /** The projection holds no row the target names, so the override changes nothing visible. */
  readonly unknownTarget: boolean;
}

/** The override as the form holds it while it is still pending. */
export interface RankingOverrideDraft {
  readonly contestId: number | null;
  readonly targetKind: string;
  readonly targetKey: string;
}

const EMPTY: RankingImpact = {
  columns: [],
  users: [],
  teams: [],
  scopeMismatch: false,
  unknownTarget: false,
};

/**
 * A person as the board words them, falling back to the projection key when the name is blank.
 *
 * WHY the key as the fallback: an unnamed row is still a row the operator can match to a hide,
 * and an empty cell would read as "no such user" — the one thing the diff exists to distinguish.
 */
function personName(row: { key: string; f_name: string; l_name: string }): string {
  const name = `${row.f_name} ${row.l_name}`.trim();
  return name === '' ? row.key : name;
}

/** A task key is the composite `<encodedContest>/<encodedTaskName>`; a bare key is the pre-composite spelling. */
function splitComposite(key: string): { contest: string | null; task: string } {
  const cut = key.indexOf('/');
  return cut === -1
    ? { contest: null, task: key }
    : { contest: key.slice(0, cut), task: key.slice(cut + 1) };
}

async function userImpact(targetKey: string): Promise<RankingImpact> {
  const rows = await prisma.ranking_users.findMany({
    where: { key: { in: keySpellings(targetKey) } },
    select: { key: true, f_name: true, l_name: true },
  });
  return {
    columns: [],
    users: rows.map(personName),
    teams: [],
    scopeMismatch: false,
    unknownTarget: rows.length === 0,
  };
}

async function teamImpact(targetKey: string): Promise<RankingImpact> {
  const [members, teams] = await Promise.all([
    prisma.ranking_users.findMany({
      where: { team: { in: keySpellings(targetKey) } },
      select: { key: true, f_name: true, l_name: true },
    }),
    prisma.ranking_teams.findMany({ where: { key: { in: keySpellings(targetKey) } }, select: { name: true } }),
  ]);
  return {
    columns: [],
    users: members.map(personName),
    teams: teams.map((team) => team.name),
    scopeMismatch: false,
    unknownTarget: members.length === 0 && teams.length === 0,
  };
}

async function taskImpact(targetKey: string, contestKey: string): Promise<RankingImpact> {
  const { contest, task } = splitComposite(targetKey);
  const rows = await prisma.ranking_tasks.findMany({
    where: contest === null ? { key: task } : { contest, key: task },
    select: { name: true },
  });
  return {
    columns: rows.map((row) => row.name),
    users: [],
    teams: [],
    scopeMismatch: contest !== null && contest !== contestKey,
    unknownTarget: rows.length === 0,
  };
}

async function contestImpact(targetKey: string, contestKey: string): Promise<RankingImpact> {
  const [tasks, contest] = await Promise.all([
    prisma.ranking_tasks.findMany({ where: { contest: targetKey }, select: { name: true } }),
    prisma.ranking_contests.findUnique({ where: { key: targetKey }, select: { name: true } }),
  ]);
  return {
    columns: tasks.map((row) => row.name),
    users: [],
    teams: [],
    scopeMismatch: targetKey !== contestKey,
    unknownTarget: tasks.length === 0 && contest === null,
  };
}

// WHY a contest fallback for the whole-board target: its key is the wildcard `*`, so the board it
// blanks is the one the shard serves, which is the encoded contest name of the scoped contest.
async function boardImpact(targetKey: string, contestKey: string): Promise<RankingImpact> {
  const tasks = await prisma.ranking_tasks.findMany({
    where: { contest: targetKey === '*' ? contestKey : targetKey },
    select: { name: true },
  });
  return {
    columns: tasks.map((row) => row.name),
    users: [],
    teams: [],
    scopeMismatch: false,
    unknownTarget: false,
  };
}

async function impactFor(draft: RankingOverrideDraft, contestKey: string): Promise<RankingImpact> {
  if (draft.targetKind === 'task') return taskImpact(draft.targetKey, contestKey);
  if (draft.targetKind === 'contest') return contestImpact(draft.targetKey, contestKey);
  if (draft.targetKind === 'team') return teamImpact(draft.targetKey);
  if (draft.targetKind === 'ranking') return boardImpact(draft.targetKey, contestKey);
  return userImpact(draft.targetKey);
}

/**
 * The board impact of one pending override, or an empty impact while the target is still blank.
 *
 * The scoped contest is resolved through the panel's own contests row so the encoded key the
 * projection files a task under is derived from the same name the reader would encode.
 */
export async function readRankingImpact(draft: RankingOverrideDraft): Promise<RankingImpact> {
  if (draft.contestId === null || draft.targetKey.trim() === '') return EMPTY;
  const contest = await prisma.contests.findUnique({
    where: { id: draft.contestId },
    select: { name: true },
  });
  if (contest === null) return { ...EMPTY, unknownTarget: true };
  return impactFor(draft, encodeId(contest.name));
}
