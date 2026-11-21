import { History } from 'lucide-react';
import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import type { UserHistory } from '@/lib/people-read-model-types';

export interface UserHistoryTabProps {
  readonly history: UserHistory;
  readonly navigation: Dictionary['navigation'];
  readonly copy: Dictionary['users'];
}

type HistoryCopy = Dictionary['users']['history'];
type UserCopy = Dictionary['users'];

interface HistoryRow {
  readonly key: string;
  readonly label: string;
}

interface SectionCopy {
  readonly title: string;
  readonly empty: string;
}

const DEFAULT_ROW_CLASS = 'py-2 text-sm';
const MONO_ROW_CLASS = 'py-2 text-sm font-mono';
const EMPTY_VALUE = '—';

// Why: the five sections differ only in how a record is read, so the row shape
// is mapped once here. History rows are an immutable read snapshot whose ids
// may be null, so the label is paired with the position for a stable key.
function toRows<T>(
  items: readonly T[],
  read: (item: T) => string,
): readonly HistoryRow[] {
  return items.map((item, index) => ({ key: `${index}-${read(item)}`, label: read(item) }));
}

// Why: a field-filtered history row can carry no id, and an unnamed row falls
// back to the same em-dash placeholder the other People tabs use.
function referenceRow(label: string, id: number | null): string {
  return id === null ? EMPTY_VALUE : interpolate(label, { id });
}

function participationLabel(row: UserHistory['participations'][number], copy: UserCopy): string {
  const { history } = copy;
  return [
    row.contestName ?? referenceRow(history.contestLabel, row.contestId),
    row.teamCode ?? copy.teamsTab.noTeam,
  ].join(' · ');
}

function submissionLabel(row: UserHistory['submissions'][number], copy: HistoryCopy): string {
  return [
    `#${row.id}`,
    row.taskName ?? referenceRow(copy.taskLabel, row.taskId),
    row.score ?? EMPTY_VALUE,
  ].join(' · ');
}

function activityLabel(row: UserHistory['recentContestActivity'][number], copy: HistoryCopy): string {
  return [
    `#${row.id}`,
    row.contestName ?? referenceRow(copy.contestLabel, row.contestId),
    row.timestamp,
  ].join(' · ');
}

function Section({
  copy,
  rows,
  rowClassName = DEFAULT_ROW_CLASS,
}: {
  copy: SectionCopy;
  rows: readonly HistoryRow[];
  rowClassName?: string;
}): React.JSX.Element {
  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-bold">{copy.title}</h2>
      {rows.length > 0 ? (
        <div className="divide-y divide-border">
          {rows.map((row) => <div key={row.key} className={rowClassName}>{row.label}</div>)}
        </div>
      ) : (
        <EmptyState icon={History} title={copy.empty} />
      )}
    </Card>
  );
}

function AccountAccess({ history, copy }: {
  readonly history: UserHistory;
  readonly copy: HistoryCopy;
}): React.JSX.Element {
  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-bold">{copy.accountAccess}</h2>
      <div className="text-sm text-foreground">
        {interpolate(copy.lastLogin, { value: history.accountAccess.lastLoginAt ?? EMPTY_VALUE })}
      </div>
    </Card>
  );
}

export function UserHistoryTab({ history, navigation, copy }: UserHistoryTabProps): React.JSX.Element {
  const historyCopy = copy.history;
  const { sections } = historyCopy;
  return (
    <div className="space-y-6">
      <h2 className="sr-only">{navigation.people['user-tabs'].history.label}</h2>
      <AccountAccess history={history} copy={historyCopy} />
      <Section
        copy={sections.contests}
        rows={toRows(history.contests, (contest) => contest.name ?? referenceRow(historyCopy.contestLabel, contest.id))}
      />
      <Section
        copy={sections.participations}
        rows={toRows(history.participations, (row) => participationLabel(row, copy))}
      />
      <Section
        copy={sections.teams}
        rowClassName={MONO_ROW_CLASS}
        rows={toRows(history.teams, (team) => team.code ?? team.name ?? referenceRow(historyCopy.teamLabel, team.id))}
      />
      <Section
        copy={sections.submissions}
        rows={toRows(history.submissions, (row) => submissionLabel(row, historyCopy))}
      />
      <Section
        copy={sections.recentActivity}
        rows={toRows(history.recentContestActivity, (row) => activityLabel(row, historyCopy))}
      />
    </div>
  );
}
