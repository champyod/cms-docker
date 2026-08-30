'use client';

export interface TaskCol { id: number; name: string; title: string; score_precision: number; }
export interface RankingEntry { participationId: number; rank: number; user: { username: string }; taskScores: Record<string, number>; totalScore: number; }

interface Props {
  ranking: { ranking: RankingEntry[]; tasks: TaskCol[] } | null;
}

export function RankingTable({ ranking }: Props) {
  if (!ranking) return null;
  return (
    <div className="overflow-x-auto">
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
                  {entry.taskScores[t.id] !== undefined ? entry.taskScores[t.id].toFixed(t.score_precision) : '-'}
                </td>
              ))}
              <td className="whitespace-nowrap p-2 text-right font-bold text-primary">{entry.totalScore.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranking.ranking.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No submissions yet.</p>}
    </div>
  );
}
