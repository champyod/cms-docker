'use client';

import { useMemo } from 'react';

export type RankingSnapshot = {
  contests: Record<string, { name: string }>;
  tasks: Record<string, { contest: string }>;
  teams: Record<string, { name: string }>;
  users: Record<string, { f_name: string; l_name: string; team: string | null }>;
  scores: Record<string, Record<string, number>>;
};

export type RankRow = {
  rank: number;
  userId: string;
  firstName: string;
  lastName: string;
  team: string;
  totalScore: number;
  solved: number;
};

type Accumulator = { totalScore: number; solved: number };

function accumulateScores(scores: Record<string, number> | undefined, taskKeys: readonly string[]): Accumulator {
  const total: Accumulator = { totalScore: 0, solved: 0 };
  if (!scores) return total;
  for (const taskId of taskKeys) {
    const value = Number(scores[taskId] || 0);
    total.totalScore += value;
    if (value > 0) total.solved += 1;
  }
  return total;
}

function buildRows(snapshot: RankingSnapshot): RankRow[] {
  const taskKeys = Object.keys(snapshot.tasks);
  const computedRows = Object.entries(snapshot.users).map(([userId, user]) => {
    // Why one pass: summing and counting separately walks the task list twice per user.
    const { totalScore, solved } = accumulateScores(snapshot.scores[userId], taskKeys);
    const teamName = user.team ? snapshot.teams[user.team]?.name || user.team : '-';
    return { rank: 0, userId, firstName: user.f_name, lastName: user.l_name, team: teamName, totalScore, solved };
  });
  computedRows.sort((left, right) => {
    if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
    const last = left.lastName.localeCompare(right.lastName);
    if (last !== 0) return last;
    const first = left.firstName.localeCompare(right.firstName);
    if (first !== 0) return first;
    return left.userId.localeCompare(right.userId);
  });
  return computedRows;
}

// Why one pass: the rank only depends on the previous row's score, so building a
// second array to stamp ranks allocates a copy of every row for nothing.
function assignRanks(rows: readonly RankRow[]): RankRow[] {
  let currentRank = 1;
  let previousScore: number | null = null;
  return rows.map((row, index) => {
    if (previousScore === null) {
      previousScore = row.totalScore;
    } else if (row.totalScore === previousScore) {
      // tie keeps rank
    } else {
      currentRank = index + 1;
      previousScore = row.totalScore;
    }
    return { ...row, rank: currentRank };
  });
}

export function useRankingRows(snapshot: RankingSnapshot | null): RankRow[] {
  return useMemo(() => {
    if (!snapshot) return [];
    return assignRanks(buildRows(snapshot));
  }, [snapshot]);
}
