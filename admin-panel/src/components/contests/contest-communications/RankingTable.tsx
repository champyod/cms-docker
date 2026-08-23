'use client';

interface TaskCol { id: number; name: string; title: string; score_precision: number; }
interface RankingEntry { participationId: number; rank: number; user: { username: string }; taskScores: Record<string, number>; totalScore: number; }

interface Props {
  ranking: { ranking: RankingEntry[]; tasks: TaskCol[] } | null;
}

export function RankingTable({ ranking }: Props) {
  if (!ranking) return null;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-max w-max text-sm">
        <thead>
          <tr className="text-left text-neutral-400 border-b border-white/5">
            <th className="p-2">#</th>
            <th className="p-2 whitespace-nowrap">User</th>
            {ranking.tasks.map((t) => <th key={t.id} className="p-2 text-center whitespace-nowrap min-w-24" title={t.title}>{t.name}</th>)}
            <th className="p-2 text-right whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {ranking.ranking.map((entry) => (
            <tr key={entry.participationId} className="border-b border-white/5 hover:bg-white/5">
              <td className="p-2 text-neutral-400">{entry.rank}</td>
              <td className="p-2 text-white font-medium whitespace-nowrap">{entry.user.username}</td>
              {ranking.tasks.map((t) => (
                <td key={t.id} className="p-2 text-center text-neutral-300 whitespace-nowrap min-w-24">
                  {entry.taskScores[t.id] !== undefined ? entry.taskScores[t.id].toFixed(t.score_precision) : '-'}
                </td>
              ))}
              <td className="p-2 text-right font-bold text-indigo-400 whitespace-nowrap">{entry.totalScore.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranking.ranking.length === 0 && <p className="text-neutral-500 text-sm text-center py-4">No submissions yet.</p>}
    </div>
  );
}
