'use client';

import { useMemo } from 'react';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/core/ResponsiveTable';

export interface TaskCol { id: number; name: string; title: string; score_precision: number; }
export interface RankingEntry { participationId: number; rank: number; user: { username: string }; taskScores: Record<string, number>; totalScore: number; }

interface Props {
  ranking: { ranking: RankingEntry[]; tasks: TaskCol[] } | null;
}

function formatTaskScore(value: number | undefined, precision: number): string {
  return value !== undefined ? value.toFixed(precision) : '-';
}

// Why: one column definition drives desktop rows and mobile cards, so
// the two layouts cannot drift apart.
function buildRankingColumns(tasks: TaskCol[]): ResponsiveColumn<RankingEntry>[] {
  return [
    { key: 'rank', header: '#', render: (entry) => <span className="text-muted-foreground">{entry.rank}</span> },
    { key: 'user', header: 'User', render: (entry) => <span className="font-medium text-foreground">{entry.user.username}</span> },
    ...tasks.map((task): ResponsiveColumn<RankingEntry> => ({
      key: `task-${task.id}`,
      header: <span title={task.title}>{task.name}</span>,
      mobileLabel: task.name,
      render: (entry) => <span className="text-muted-foreground">{formatTaskScore(entry.taskScores[task.id], task.score_precision)}</span>,
    })),
    { key: 'total', header: 'Total', render: (entry) => <span className="font-bold text-primary">{entry.totalScore.toFixed(0)}</span> },
  ];
}

export function RankingTable({ ranking }: Props): React.JSX.Element | null {
  const columns = useMemo(() => buildRankingColumns(ranking?.tasks ?? []), [ranking?.tasks]);
  if (!ranking) return null;
  return (
    <ResponsiveTable
      columns={columns}
      rows={ranking.ranking}
      getRowKey={(entry) => entry.participationId}
      outerClassName="overflow-x-auto"
      className="w-max min-w-max"
      emptyState={<p className="py-4 text-center text-sm text-muted-foreground">No submissions yet.</p>}
    />
  );
}
