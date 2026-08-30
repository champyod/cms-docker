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

function buildRows(snapshot: RankingSnapshot): RankRow[] {
  const taskKeys = Object.keys(snapshot.tasks);
  const computedRows = Object.entries(snapshot.users).map(([userId, user]) => {
    const userScores = snapshot.scores[userId] || {};
    const totalScore = taskKeys.reduce((sum, taskId) => sum + Number(userScores[taskId] || 0), 0);
    const solved = taskKeys.filter((taskId) => Number(userScores[taskId] || 0) > 0).length;
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

function assignRanks(rows: RankRow[]): RankRow[] {
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
