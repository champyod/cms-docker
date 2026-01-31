'use server'

import { prisma } from '@/lib/prisma';

// Get ranking data for a contest
export async function getRanking(contestId: number) {
  // Get all participations with their submissions
  const participations = await prisma.participations.findMany({
    where: { 
      contest_id: contestId,
      hidden: false,
    },
    include: {
      users: {
        select: { id: true, username: true, first_name: true, last_name: true }
      },
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
    }
  });

  // Get tasks for this contest
  const tasks = await prisma.tasks.findMany({
    where: { contest_id: contestId },
    orderBy: { num: 'asc' },
    select: { id: true, name: true, title: true, num: true, score_precision: true }
  });

  // Calculate scores per user per task
  const ranking = participations.map((p: any) => {
    const taskScores: Record<number, number> = {};
    
    // Group submissions by task and get best score
    p.submissions.forEach((sub: any) => {
      if (sub.tasks) {
        const taskId = sub.tasks.id;
        // Get score from active dataset result
        const results = sub.submission_results;
        results.forEach((res: any) => {
          if (res.score !== null) {
            const score = Number(res.score);
            if (!taskScores[taskId] || score > taskScores[taskId]) {
              taskScores[taskId] = score;
            }
          }
        });
      }
    });

    const totalScore = Object.values(taskScores).reduce((sum, s) => sum + s, 0);

    return {
      user: p.users,
      taskScores,
      totalScore,
      participationId: p.id,
    };
  });

  // Sort by total score descending
  ranking.sort((a: any, b: any) => b.totalScore - a.totalScore);

  // Assign ranks
  let currentRank = 1;
  ranking.forEach((entry: any, index: number) => {
    if (index > 0 && entry.totalScore < ranking[index - 1].totalScore) {
      currentRank = index + 1;
    }
    (entry as any).rank = currentRank;
  });

  return { ranking, tasks };
}
