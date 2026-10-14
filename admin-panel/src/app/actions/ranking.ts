'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';

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
  return { contests, userKeys, teamKeys };
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
