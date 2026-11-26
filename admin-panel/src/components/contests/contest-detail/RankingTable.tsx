'use client';

import { useMemo } from 'react';
import { CellText } from '@/components/core/CellText';
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
    {
      key: 'rank',
      header: '#',
      cellClassName: 'w-16',
      render: (entry) => <CellText width="id" mono muted>#{entry.rank}</CellText>,
    },
    {
      key: 'user',
      header: 'User',
      cellClassName: 'min-w-[120px]',
      render: (entry) => <CellText width="md" bold>{entry.user.username}</CellText>,
    },
    ...tasks.map((task): ResponsiveColumn<RankingEntry> => ({
      key: `task-${task.id}`,
      header: <span title={task.title}>{task.name}</span>,
      mobileLabel: task.name,
      cellClassName: 'min-w-[80px]',
      render: (entry) => (
        <CellText width="sm" mono muted>
          {formatTaskScore(entry.taskScores[task.id], task.score_precision)}
        </CellText>
      ),
    })),
    {
      key: 'total',
      header: 'Total',
      cellClassName: 'w-24 text-right',
      render: (entry) => (
        <CellText width="sm" mono bold className="text-primary text-right">
          {entry.totalScore.toFixed(0)}
        </CellText>
      ),
    },
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
      outerClassName="w-full overflow-x-auto"
      className="w-full"
      emptyState={<p className="py-4 text-center text-sm text-muted-foreground">No submissions yet.</p>}
    />
  );
}
