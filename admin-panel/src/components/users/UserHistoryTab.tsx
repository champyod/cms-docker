import { History } from 'lucide-react';
import { EmptyState } from '@/components/core/EmptyState';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import type { UserHistory } from '@/lib/people-read-model-types';

export interface UserHistorySectionProps {
  readonly section: UserHistorySectionKey;
  readonly history: UserHistory;
  readonly copy: Dictionary['users'];
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
const EMPTY_VALUE = '—';

// Why: history rows are an immutable read snapshot whose ids may be null, so the label is paired
// with the position for a stable key.
function toRows<T>(items: readonly T[], read: (item: T) => string): readonly HistoryRow[] {
  return items.map((item, index) => ({ key: `${index}-${read(item)}`, label: read(item) }));
}

// Why: a field-filtered history row can carry no id, and an unnamed row falls back to the same
// em-dash placeholder the other People tabs use.
function referenceRow(label: string, id: number | null): string {
  return id === null ? EMPTY_VALUE : interpolate(label, { id });
}

function participationLabel(row: UserHistory['participations'][number], copy: UserCopy): string {
  const { history } = copy;
  return [
    row.contestName ?? referenceRow(history.contestLabel, row.contestId),
    row.teamCode ?? copy.teamsTab.noTeam,
  ].join(', ');
}

function submissionLabel(row: UserHistory['submissions'][number], copy: HistoryCopy): string {
  return [
    `#${row.id}`,
    row.taskName ?? referenceRow(copy.taskLabel, row.taskId),
    row.score ?? EMPTY_VALUE,
  ].join(', ');
}

function activityLabel(row: UserHistory['recentContestActivity'][number], copy: HistoryCopy): string {
  return [
    `#${row.id}`,
    row.contestName ?? referenceRow(copy.contestLabel, row.contestId),
    row.timestamp,
  ].join(', ');
}

function rowsFor(
  section: UserHistorySectionKey,
  history: UserHistory,
  copy: UserCopy,
): { readonly rows: readonly HistoryRow[]; readonly mono: boolean } {
  const { history: historyCopy } = copy;
  switch (section) {
    case 'contests':
      return {
        rows: toRows(history.contests, (contest) => contest.name ?? referenceRow(historyCopy.contestLabel, contest.id)),
        mono: false,
      };
    case 'participations':
      return { rows: toRows(history.participations, (row) => participationLabel(row, copy)), mono: false };
    case 'teams':
      return {
        rows: toRows(history.teams, (team) => team.code ?? team.name ?? referenceRow(historyCopy.teamLabel, team.id)),
        mono: true,
      };
    case 'submissions':
      return { rows: toRows(history.submissions, (row) => submissionLabel(row, historyCopy)), mono: false };
    case 'recentActivity':
      return { rows: toRows(history.recentContestActivity, (row) => activityLabel(row, historyCopy)), mono: false };
  }
}

/**
 * One of the five histories, as rows only.
 *
 * Why no card and no heading: the board layout draws a card per section and carries the section's
 * title and its meaning of empty, so the five cards this component used to draw were five boxes
 * inside the frame that already framed them.
 */
export function UserHistorySection({ section, history, copy }: UserHistorySectionProps): React.JSX.Element {
  const { rows, mono } = rowsFor(section, history, copy);
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => <div key={row.key} className={mono ? MONO_ROW_CLASS : DEFAULT_ROW_CLASS}>{row.label}</div>)}
    </div>
  );
}

/** When this account last signed in — one value, and the only one the five sections cannot state. */
export function UserHistoryAccountAccess({ history, copy }: {
  readonly history: UserHistory;
  readonly copy: Dictionary['users'];
}): React.JSX.Element {
  return (
    <p className="text-sm text-foreground">
      {interpolate(copy.history.lastLogin, { value: history.accountAccess.lastLoginAt ?? EMPTY_VALUE })}
    </p>
  );
}

/** What empty means for one section: "no teams" differs from "no submissions". */
export function UserHistoryEmpty({ title }: { readonly title: string }): React.JSX.Element {
  return <EmptyState icon={History} title={title} />;
}
