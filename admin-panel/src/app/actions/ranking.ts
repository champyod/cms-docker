'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';

const rankingParticipationsInclude = {
  users: { select: { id: true, username: true, first_name: true, last_name: true } },
  submissions: {
    where: { official: true },
    include: {
      tasks: { select: { id: true, name: true, title: true, num: true } },
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

type RankedParticipation = Prisma.participationsGetPayload<{ include: typeof rankingParticipationsInclude }>;

interface RankingEntry {
  user: RankedParticipation['users'];
  taskScores: Record<number, number>;
  totalScore: number;
  participationId: number;
  rank: number;
}

export async function getRanking(contestId: number) {
  await ensurePermission('contests');

  const [participations, tasks] = await Promise.all([
    prisma.participations.findMany({
      where: {
        contest_id: contestId,
        hidden: false,
      },
      include: rankingParticipationsInclude,
    }),
    prisma.tasks.findMany({
      where: { contest_id: contestId },
      orderBy: { num: 'asc' },
      select: { id: true, name: true, title: true, num: true, score_precision: true }
    }),
  ]);

  const ranking = buildRanking(participations);

  return { ranking, tasks };
}

function buildRanking(participations: RankedParticipation[]): RankingEntry[] {
  const ranking = participations.map((p) => ({
    user: p.users,
    taskScores: collectBestScoresPerTask(p.submissions),
    totalScore: 0,
    participationId: p.id,
    rank: 0,
  }));

  for (const entry of ranking) {
    entry.totalScore = Object.values(entry.taskScores).reduce((sum, s) => sum + s, 0);
  }

  return assignRanks(ranking.sort((a, b) => b.totalScore - a.totalScore));
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

function assignRanks(sorted: RankingEntry[]): RankingEntry[] {
  let currentRank = 1;
  sorted.forEach((entry, index) => {
    if (index > 0 && entry.totalScore < sorted[index - 1].totalScore) {
      currentRank = index + 1;
    }
    entry.rank = currentRank;
  });
  return sorted;
}
