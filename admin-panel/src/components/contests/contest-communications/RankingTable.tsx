'use client';

import { MobileCard, MobileCardRow } from '@/components/core/MobileCard';

export interface TaskCol { id: number; name: string; title: string; score_precision: number; }
export interface RankingEntry { participationId: number; rank: number; user: { username: string }; taskScores: Record<string, number>; totalScore: number; }

interface Props {
  ranking: { ranking: RankingEntry[]; tasks: TaskCol[] } | null;
}

function formatTaskScore(value: number | undefined, precision: number): string {
  return value !== undefined ? value.toFixed(precision) : '-';
}

function RankingMobileList({ ranking }: { ranking: NonNullable<Props['ranking']> }): React.JSX.Element {
  return (
    <div className="space-y-3 md:hidden">
      {ranking.ranking.map((entry) => (
        <MobileCard key={entry.participationId}>
          <MobileCardRow label="#" value={entry.rank} />
          <MobileCardRow label="User" value={entry.user.username} />
          {ranking.tasks.map((task) => (
            <MobileCardRow key={task.id} label={task.name} value={formatTaskScore(entry.taskScores[task.id], task.score_precision)} />
          ))}
          <MobileCardRow label="Total" value={entry.totalScore.toFixed(0)} />
        </MobileCard>
      ))}
    </div>
  );
}

function RankingDesktopTable({ ranking }: { ranking: NonNullable<Props['ranking']> }): React.JSX.Element {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="min-w-max w-max text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="p-2">#</th>
            <th className="whitespace-nowrap p-2">User</th>
            {ranking.tasks.map((t) => <th key={t.id} className="min-w-24 whitespace-nowrap p-2 text-center" title={t.title}>{t.name}</th>)}
            <th className="whitespace-nowrap p-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {ranking.ranking.map((entry) => (
            <tr key={entry.participationId} className="border-b border-border transition-colors hover:bg-muted/50">
              <td className="p-2 text-muted-foreground">{entry.rank}</td>
              <td className="whitespace-nowrap p-2 font-medium text-foreground">{entry.user.username}</td>
              {ranking.tasks.map((t) => (
                <td key={t.id} className="min-w-24 whitespace-nowrap p-2 text-center text-muted-foreground">
                  {formatTaskScore(entry.taskScores[t.id], t.score_precision)}
                </td>
              ))}
              <td className="whitespace-nowrap p-2 text-right font-bold text-primary">{entry.totalScore.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RankingTable({ ranking }: Props): React.JSX.Element | null {
  if (!ranking) return null;
  if (ranking.ranking.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No submissions yet.</p>;
  return (
    <>
      <RankingMobileList ranking={ranking} />
      <RankingDesktopTable ranking={ranking} />
    </>
  );
}
