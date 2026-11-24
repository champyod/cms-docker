import { History } from 'lucide-react';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import type { UserHistory } from '@/lib/people-read-model-types';

export interface UserHistorySectionProps {
  readonly section: UserHistorySectionKey;
  readonly history: UserHistory;
  readonly copy: Dictionary['users'];
  /** common.notSet: a row whose value the record does not hold. */
  readonly missing: string;
}

/** The five histories one user record carries; each is a different record kind with its own empty. */
export type UserHistorySectionKey =
  | 'contests'
  | 'participations'
  | 'teams'
  | 'submissions'
  | 'recentActivity';

type HistoryCopy = Dictionary['users']['history'];
type UserCopy = Dictionary['users'];

interface HistoryRow {
  readonly key: string;
  readonly label: string;
}

const DEFAULT_ROW_CLASS = 'py-2 text-sm';
const MONO_ROW_CLASS = 'py-2 text-sm font-mono';

// History rows are an immutable snapshot whose ids may be null, so the key pairs the label with the position.
function toRows<T>(items: readonly T[], read: (item: T) => string): readonly HistoryRow[] {
  return items.map((item, index) => ({ key: `${index}-${read(item)}`, label: read(item) }));
}

// A field-filtered row can carry no id, so an unnamed row falls back to the shared missing word.
function referenceRow(label: string, id: number | null, missing: string): string {
  return id === null ? missing : interpolate(label, { id });
}

function participationLabel(row: UserHistory['participations'][number], copy: UserCopy, missing: string): string {
  const { history } = copy;
  return [
    row.contestName ?? referenceRow(history.contestLabel, row.contestId, missing),
    row.teamCode ?? copy.teamsTab.noTeam,
  ].join(', ');
}

function submissionLabel(row: UserHistory['submissions'][number], copy: HistoryCopy, missing: string): string {
  return [
    `#${row.id}`,
    row.taskName ?? referenceRow(copy.taskLabel, row.taskId, missing),
    row.score ?? missing,
  ].join(', ');
}

function activityLabel(row: UserHistory['recentContestActivity'][number], copy: HistoryCopy, missing: string): string {
  return [
    `#${row.id}`,
    row.contestName ?? referenceRow(copy.contestLabel, row.contestId, missing),
    row.timestamp,
  ].join(', ');
}

function rowsFor(
  section: UserHistorySectionKey,
  history: UserHistory,
  copy: UserCopy,
  missing: string,
): { readonly rows: readonly HistoryRow[]; readonly mono: boolean } {
  const { history: historyCopy } = copy;
  switch (section) {
    case 'contests':
      return {
        rows: toRows(history.contests, (contest) => contest.name ?? referenceRow(historyCopy.contestLabel, contest.id, missing)),
        mono: false,
      };
    case 'participations':
      return { rows: toRows(history.participations, (row) => participationLabel(row, copy, missing)), mono: false };
    case 'teams':
      return {
        rows: toRows(history.teams, (team) => team.code ?? team.name ?? referenceRow(historyCopy.teamLabel, team.id, missing)),
        mono: true,
      };
    case 'submissions':
      return { rows: toRows(history.submissions, (row) => submissionLabel(row, historyCopy, missing)), mono: false };
    case 'recentActivity':
      return { rows: toRows(history.recentContestActivity, (row) => activityLabel(row, historyCopy, missing)), mono: false };
  }
}

export function UserHistorySection({ section, history, copy, missing }: UserHistorySectionProps): React.JSX.Element {
  const { rows, mono } = rowsFor(section, history, copy, missing);
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => <div key={row.key} className={mono ? MONO_ROW_CLASS : DEFAULT_ROW_CLASS}>{row.label}</div>)}
    </div>
  );
}

/** When this account last signed in — one value, and the only one the five sections cannot state. */
export function UserHistoryAccountAccess({ history, copy, missing }: {
  readonly history: UserHistory;
  readonly copy: Dictionary['users'];
  /** common.notSet: a row whose value the record does not hold. */
  readonly missing: string;
}): React.JSX.Element {
  return (
    <p className="text-sm text-foreground">
      {interpolate(copy.history.lastLogin, { value: history.accountAccess.lastLoginAt ?? missing })}
    </p>
  );
}

/** What empty means for one section: "no teams" differs from "no submissions". */
export function UserHistoryEmpty({ title }: { readonly title: string }): React.JSX.Element {
  return <EmptyState icon={History} title={title} />;
}
