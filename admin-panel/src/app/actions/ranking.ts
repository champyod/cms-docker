'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { encodeId } from '@/lib/ranking-projection';
import { readRankingImpact, type RankingImpact } from '@/lib/ranking-impact';

const rankingParticipationsInclude = {
  users: { select: { id: true, username: true, first_name: true, last_name: true } },
  submissions: {
    where: { official: true },
    include: {
      tasks: { select: { id: true, name: true, title: true } },
      submission_results: {
        where: {
          datasets: {
            tasks_datasets_task_idTotasks: {
              active_dataset_id: { not: null }
            }
          }
        },
        select: { score: true, dataset_id: true }
      }
    }
  }
} satisfies Prisma.participationsInclude;

// The operator's view adds the team and the hidden flag the public board filters out.
const rankingUsersInclude = {
  ...rankingParticipationsInclude,
  teams: { select: { id: true, name: true } },
} satisfies Prisma.participationsInclude;

type RankedParticipation = Prisma.participationsGetPayload<{ include: typeof rankingParticipationsInclude }>;
type RankedUserParticipation = Prisma.participationsGetPayload<{ include: typeof rankingUsersInclude }>;

interface Rankable {
  totalScore: number;
  rank: number;
}

export interface RankingEntry {
  user: RankedParticipation['users'];
  taskScores: Record<number, number>;
  totalScore: number;
  participationId: number;
  rank: number;
}

export interface RankingTaskColumn {
  id: number;
  name: string;
  title: string;
  num: number | null;
  score_precision: number;
}

export interface RankingBoard {
  ranking: RankingEntry[];
  tasks: RankingTaskColumn[];
}

export interface RankingUserEntry {
  participationId: number;
  contestId: number;
  userId: number;
  username: string;
  displayName: string;
  teamName: string | null;
  hidden: boolean;
  taskScores: Record<number, number>;
  totalScore: number;
  rank: number;
}

export interface RankingTask {
  id: number;
  name: string;
  title: string;
  scorePrecision: number;
}

export interface RankingUserDetail {
  entry: RankingUserEntry;
  tasks: RankingTask[];
}

export async function getRanking(contestId: number): Promise<RankingBoard> {
  await ensurePermission('ranking:list');

  const [participations, taskMemberships] = await Promise.all([
    prisma.participations.findMany({
      where: {
        contest_id: contestId,
        hidden: false,
      },
      include: rankingParticipationsInclude,
    }),
    prisma.contest_tasks.findMany({
      where: { contest_id: contestId },
      orderBy: { num: 'asc' },
      select: { num: true, tasks: { select: { id: true, name: true, title: true, score_precision: true } } },
    }),
  ]);

  const tasks = taskMemberships.map((row) => ({ ...row.tasks, num: row.num }));
  return { ranking: buildRanking(participations), tasks };
}

// The operator's list keeps the hidden participations the public board drops.
export async function getRankingUsers(): Promise<RankingUserEntry[]> {
  await ensurePermission('ranking:list');
  const participations = await prisma.participations.findMany({
    include: rankingUsersInclude,
    orderBy: { id: 'asc' },
  });
  return buildUserRanking(participations);
}

export interface RankingOverrideOptions {
  contests: Array<{ id: number; name: string }>;
  userKeys: Array<{ key: string; label: string }>;
  teamKeys: string[];
  contestKeys: Array<{ key: string; label: string }>;
  taskKeys: Array<{ key: string; label: string }>;
}

/**
 * The contests a board may be selected for.
 *
 * WHY it is separate from getRankingOverrideOptions: that one is gated on
 * ranking:override because it feeds the override form. Reading a board only needs
 * ranking:list, and a reader who may look but not override must still be able to pick
 * a contest.
 */
export async function getRankingBoardContests(): Promise<Array<{ id: number; name: string }>> {
  await ensurePermission('ranking:list');
  return prisma.contests.findMany({ select: { id: true, name: true }, orderBy: { id: 'desc' } });
}

export async function getRankingOverrideOptions(): Promise<RankingOverrideOptions> {
  await ensurePermission('ranking:override');
  const [contests, entries] = await Promise.all([
    prisma.contests.findMany({ select: { id: true, name: true }, orderBy: { id: 'desc' } }),
    getRankingUsers(),
  ]);
  const userKeys = [...new Map(entries.map((entry) => [entry.username, entry.displayName])).entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const teamKeys = [
    ...new Set(entries.map((entry) => entry.teamName).filter((name): name is string => name !== null)),
  ].sort();
  const contestKeys = listOverrideContestKeys(contests);
  const taskKeys = await listOverrideTaskKeys(contests);
  return { contests, userKeys, teamKeys, contestKeys, taskKeys };
}

/**
 * WHY one entry per contest, keyed the way the projection files a task under a contest: a
 * contest hide drops the contest and every task filed under it, so the picker offers the
 * encoded contest name the board keys the group by rather than the numeric contest id.
 */
function listOverrideContestKeys(
  contests: ReadonlyArray<{ id: number; name: string }>,
): Array<{ key: string; label: string }> {
  return [...new Map(contests.map((contest) => [encodeId(contest.name), contest.name])).entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * WHY one entry per (contest, task) membership: a task may sit in many contests, and a
 * composite key hides it only inside the contest the key names, so the picker offers one
 * entry per pair — `${contestKey}/${taskKey}`, both encoded — rather than one per task name.
 * The membership read stays on contest_tasks, which is where the many-to-many lives.
 */
async function listOverrideTaskKeys(
  contests: ReadonlyArray<{ id: number; name: string }>,
): Promise<Array<{ key: string; label: string }>> {
  const perContest = await Promise.all(
    contests.map(async (contest) => {
      const tasks = await listRankingTasks(contest.id);
      return tasks.map((task) => ({ contest, task }));
    }),
  );
  const byKey = new Map<string, string>();
  for (const { contest, task } of perContest.flat()) {
    const key = `${encodeId(contest.name)}/${encodeId(task.name)}`;
    byKey.set(key, `${contest.name} / ${task.name}`);
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export async function getRankingUserDetail(username: string): Promise<RankingUserDetail | null> {
  await ensurePermission('ranking:list');
  const target = await prisma.participations.findFirst({
    where: { users: { username } },
    orderBy: { id: 'asc' },
    select: { contest_id: true, user_id: true },
  });
  if (target === null) return null;
  const participations = await prisma.participations.findMany({
    where: { contest_id: target.contest_id },
    include: rankingUsersInclude,
    orderBy: { id: 'asc' },
  });
  const entry = buildUserRanking(participations)
    .find((candidate) => candidate.userId === target.user_id);
  if (entry === undefined) return null;
  return { entry, tasks: await listRankingTasks(target.contest_id) };
}

async function listRankingTasks(contestId: number): Promise<RankingTask[]> {
  const rows = await prisma.contest_tasks.findMany({
    where: { contest_id: contestId },
    orderBy: { num: 'asc' },
    select: { tasks: { select: { id: true, name: true, title: true, score_precision: true } } },
  });
  return rows.map((row) => ({
    id: row.tasks.id,
    name: row.tasks.name,
    title: row.tasks.title,
    scorePrecision: row.tasks.score_precision,
  }));
}

function buildRanking(participations: readonly RankedParticipation[]): RankingEntry[] {
  return rankParticipations(participations, (participation) => ({
    user: participation.users,
    taskScores: collectBestScoresPerTask(participation.submissions),
    totalScore: 0,
    participationId: participation.id,
    rank: 0,
  }));
}

// Each contest is ranked on its own, so two contests in one deployment cannot share a board.
function buildUserRanking(participations: readonly RankedUserParticipation[]): RankingUserEntry[] {
  const byContest = new Map<number, RankedUserParticipation[]>();
  for (const participation of participations) {
    const group = byContest.get(participation.contest_id);
    if (group === undefined) byContest.set(participation.contest_id, [participation]);
    else group.push(participation);
  }
  return [...byContest.values()].flatMap((group) =>
    rankParticipations(group, (participation) => ({
      participationId: participation.id,
      contestId: participation.contest_id,
      userId: participation.users.id,
      username: participation.users.username,
      displayName: displayName(participation.users),
      teamName: participation.teams?.name ?? null,
      hidden: participation.hidden,
      taskScores: collectBestScoresPerTask(participation.submissions),
      totalScore: 0,
      rank: 0,
    })),
  );
}

function rankParticipations<T extends Rankable & { taskScores: Record<number, number> }, P extends RankedParticipation>(
  participations: readonly P[],
  toEntry: (participation: P) => T,
): T[] {
  const entries = participations.map((participation) => {
    const entry = toEntry(participation);
    entry.totalScore = sumTaskScores(entry.taskScores);
    return entry;
  });
  return assignRanks(entries.sort((a, b) => b.totalScore - a.totalScore));
}

function displayName(user: RankedParticipation['users']): string {
  const name = `${user.first_name} ${user.last_name}`.trim();
  return name === '' ? user.username : name;
}

function sumTaskScores(taskScores: Record<number, number>): number {
  return Object.values(taskScores).reduce((sum, score) => sum + score, 0);
}

function collectBestScoresPerTask(submissions: RankedParticipation['submissions']): Record<number, number> {
  const taskScores: Record<number, number> = {};

  submissions.forEach((sub) => {
    if (!sub.tasks) return;
    const taskId = sub.tasks.id;
    sub.submission_results.forEach((res) => {
      if (res.score !== null) {
        const score = Number(res.score);
        if (!taskScores[taskId] || score > taskScores[taskId]) {
          taskScores[taskId] = score;
        }
      }
    });
  });

  return taskScores;
}

function assignRanks<T extends Rankable>(sorted: T[]): T[] {
  let currentRank = 1;
  sorted.forEach((entry, index) => {
    if (index > 0 && entry.totalScore < sorted[index - 1].totalScore) {
      currentRank = index + 1;
    }
    entry.rank = currentRank;
  });
  return sorted;
}

/** One target the combobox may offer, carrying the kind it belongs to. */
export interface RankingTargetMatch {
  readonly kind: string;
  readonly key: string;
  readonly label: string;
}

const TARGET_SEARCH_LIMIT = 20;

async function searchUsers(term: string): Promise<RankingTargetMatch[]> {
  const rows = await prisma.users.findMany({
    where: {
      OR: [
        { username: { contains: term, mode: 'insensitive' } },
        { first_name: { contains: term, mode: 'insensitive' } },
        { last_name: { contains: term, mode: 'insensitive' } },
      ],
    },
    take: TARGET_SEARCH_LIMIT,
    select: { id: true, username: true, first_name: true, last_name: true },
  });
  return rows.map((row) => ({ kind: 'user', key: row.username, label: displayName(row) }));
}

async function searchTeams(term: string): Promise<RankingTargetMatch[]> {
  const rows = await prisma.teams.findMany({
    where: { name: { contains: term, mode: 'insensitive' } },
    take: TARGET_SEARCH_LIMIT,
    select: { name: true },
  });
  return rows.map((row) => ({ kind: 'team', key: row.name, label: row.name }));
}

async function searchContests(term: string): Promise<RankingTargetMatch[]> {
  const rows = await prisma.contests.findMany({
    where: { name: { contains: term, mode: 'insensitive' } },
    take: TARGET_SEARCH_LIMIT,
    select: { name: true },
  });
  return rows.map((row) => ({ kind: 'contest', key: encodeId(row.name), label: row.name }));
}

/**
 * WHY the task search is scoped to the contest the shard serves: a task hide is keyed by the
 * composite `<encodedContest>/<encodedTaskName>`, so the contest half is only known once a contest
 * is chosen — and the composite is only valid for a task that is a member of that contest.
 */
async function searchTasks(term: string, contestId: number | null): Promise<RankingTargetMatch[]> {
  if (contestId === null) return [];
  const contest = await prisma.contests.findUnique({
    where: { id: contestId },
    select: { name: true },
  });
  if (contest === null) return [];
  const memberships = await prisma.contest_tasks.findMany({
    where: { contest_id: contestId },
    select: { tasks: { select: { name: true, title: true } } },
  });
  const lower = term.toLowerCase();
  const contestKey = encodeId(contest.name);
  return memberships
    .filter((row) => {
      const name = row.tasks.name.toLowerCase();
      const title = row.tasks.title.toLowerCase();
      return name.includes(lower) || title.includes(lower);
    })
    .slice(0, TARGET_SEARCH_LIMIT)
    .map((row) => ({
      kind: 'task',
      key: `${contestKey}/${encodeId(row.tasks.name)}`,
      label: `${contest.name} / ${row.tasks.name}`,
    }));
}

async function matchesForKind(
  kind: string,
  term: string,
  contestId: number | null,
): Promise<RankingTargetMatch[]> {
  if (kind === 'user') return searchUsers(term);
  if (kind === 'team') return searchTeams(term);
  if (kind === 'task') return searchTasks(term, contestId);
  if (kind === 'contest') return searchContests(term);
  return [];
}

/**
 * The fuzzy target search the combobox runs server-side, restricted to the chosen kind.
 *
 * WHY the contest matches ride along for every other kind: contest is deliberately absent from the
 * kind menu (it is wired, D2), but it must stay reachable, so its matches are appended rather than
 * dropped. The caller reads each match's own `kind`, so picking one can switch the target kind.
 *
 * WHY the search is here and the dropdown list is not: a kind's unique list is fetched once and
 * filtered in the browser, while an arbitrary query must be answered against rows the browser does
 * not hold — the users, teams, contests and tasks tables.
 */
export async function searchRankingTargets(
  kind: string,
  query: string,
  contestId: number | null,
): Promise<RankingTargetMatch[]> {
  await ensurePermission('ranking:override');
  const term = query.trim();
  if (term === '') return [];
  const matches = await matchesForKind(kind, term, contestId);
  if (kind === 'contest') return matches;
  return [...matches, ...(await searchContests(term))];
}

/**
 * The board impact of one pending override, read from the projection for the scoped contest.
 * WHY the shard's own contest is passed rather than the draft's key: the reader filters every row
 * by the contest the shard serves, so the impact must be computed for that contest or it would
 * describe a board the shard does not draw.
 */
export async function getRankingImpact(
  contestId: number,
  targetKind: string,
  targetKey: string,
): Promise<RankingImpact> {
  await ensurePermission('ranking:override');
  return readRankingImpact({ contestId, targetKind, targetKey });
}
