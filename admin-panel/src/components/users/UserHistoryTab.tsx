import { History } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import type { UserHistory } from '@/lib/people-read-model-types';

export interface UserHistoryTabProps {
  readonly history: UserHistory;
  readonly navigation: Dictionary['navigation'];
}

interface HistoryRow {
  readonly key: string;
  readonly label: string;
}

const DEFAULT_ROW_CLASS = 'py-2 text-sm';

// Why: the five sections differ only in how a record is read, so the row shape
// is mapped once here. History rows are an immutable read snapshot whose ids
// may be null, so the label is paired with the position for a stable key.
function toRows<T>(
  items: readonly T[],
  read: (item: T) => string,
): readonly HistoryRow[] {
  return items.map((item, index) => ({ key: `${index}-${read(item)}`, label: read(item) }));
}

function Section({
  title,
  empty,
  rows,
  rowClassName = DEFAULT_ROW_CLASS,
}: {
  title: string;
  empty: string;
  rows: readonly HistoryRow[];
  rowClassName?: string;
}): React.JSX.Element {
  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-bold">{title}</h2>
      {rows.length > 0 ? (
        <div className="divide-y divide-border">
          {rows.map((row) => <div key={row.key} className={rowClassName}>{row.label}</div>)}
        </div>
      ) : (
        <EmptyState icon={History} title={empty} />
      )}
    </Card>
  );
}

export function UserHistoryTab({ history, navigation }: UserHistoryTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h2 className="sr-only">{navigation.people['user-tabs'].history.label}</h2>
      <Card className="p-4 space-y-3">
        <h2 className="font-bold">Account Access</h2>
        <div className="text-sm text-foreground">Last login: {history.accountAccess.lastLoginAt ?? '—'}</div>
      </Card>
      <Section
        title="Contests"
        empty="No contest activity."
        rows={toRows(history.contests, (contest) => contest.name ?? `Contest #${contest.id}`)}
      />
      <Section
        title="Participations"
        empty="No participations."
        rows={toRows(history.participations, (row) => `${row.contestName ?? `Contest #${row.contestId}`} · ${row.teamCode ?? 'No team'}`)}
      />
      <Section
        title="Teams"
        empty="No teams."
        rowClassName="py-2 text-sm font-mono"
        rows={toRows(history.teams, (team) => team.code ?? team.name ?? `Team #${team.id}`)}
      />
      <Section
        title="Submissions"
        empty="No submissions."
        rows={toRows(history.submissions, (row) => `#${row.id} · ${row.taskName ?? `Task #${row.taskId}`} · ${row.score ?? '—'}`)}
      />
      <Section
        title="Recent Activity"
        empty="No recent activity."
        rows={toRows(history.recentContestActivity, (row) => `#${row.id} · ${row.contestName ?? `Contest #${row.contestId}`} · ${row.timestamp}`)}
      />
    </div>
  );
}
