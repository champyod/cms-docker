'use client';

import { Eye, FileCode, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useState } from 'react';

import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { Input } from '@/components/core/Input';
import { RecordList } from '@/components/list/RecordList';
import { RecordListPager } from '@/components/list/RecordListPager';
import { RowActionLink } from '@/components/list/RowActionLink';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useDictionary } from '@/hooks/useDictionary';
import { useSyncedState } from '@/hooks/useSyncedState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { ListSortInput } from '@/lib/list-sorting';
import type { SubmissionListItem } from '@/types';

import { buildSubmissionColumns } from './submissionColumns';

export interface SubmissionListProps {
  readonly initialSubmissions: readonly SubmissionListItem[];
  readonly totalPages: number;
  readonly currentPage: number;
  readonly navigation: Dictionary['navigation'];
  readonly initialSort?: ListSortInput;
  /**
   * The active narrowing. Optional because the list is also rendered without one, and
   * an absent filter means "everything" rather than "nothing".
   */
  readonly filters?: SubmissionFilters;
}

/** The contest/task/user narrowing the list query already supports. */
export interface SubmissionFilters {
  readonly contestId?: number;
  readonly taskId?: number;
  readonly userId?: number;
}

function recordHref(locale: string, submission: SubmissionListItem): string {
  return buildRoute(locale, 'evaluation.submission-record', { id: submission.id });
}

/**
 * The narrowing controls, driven entirely by the URL.
 *
 * WHY a form and not local state: the filter is a property of the view, not of the
 * component, so it belongs in the address bar — an operator can share or bookmark the
 * exact list they are looking at, and a reload keeps it. Every push resets the page,
 * because page 4 of the unfiltered list is not page 4 of a filtered one.
 *
 * WHY the labels are literal strings: this component already renders its own copy that
 * way ("No submissions found", and the pager's "Page 1 of 2"), so it matches the file's
 * existing convention rather than inventing a second one for two fields. They should
 * move into the dictionary with the rest of this component's copy.
 */
function SubmissionFiltersBar({
  filters,
  onApply,
}: {
  readonly filters: SubmissionFilters;
  readonly onApply: (next: SubmissionFilters) => void;
}): React.JSX.Element {
  const [contest, setContest] = useState(filters.contestId === undefined ? '' : String(filters.contestId));
  const [task, setTask] = useState(filters.taskId === undefined ? '' : String(filters.taskId));
  const [user, setUser] = useState(filters.userId === undefined ? '' : String(filters.userId));

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onApply({
      ...(readId(contest) === undefined ? {} : { contestId: readId(contest) }),
      ...(readId(task) === undefined ? {} : { taskId: readId(task) }),
      ...(readId(user) === undefined ? {} : { userId: readId(user) }),
    });
  };

  const clear = (): void => {
    setContest('');
    setTask('');
    setUser('');
    onApply({});
  };

  const hasAny = contest !== '' || task !== '' || user !== '';

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Input
        label="Contest id"
        name="contest"
        inputMode="numeric"
        value={contest}
        onChange={(event) => setContest(event.target.value)}
        className="w-28"
      />
      <Input
        label="Task id"
        name="task"
        inputMode="numeric"
        value={task}
        onChange={(event) => setTask(event.target.value)}
        className="w-28"
      />
      <Input
        label="User id"
        name="user"
        inputMode="numeric"
        value={user}
        onChange={(event) => setUser(event.target.value)}
        className="w-28"
      />
      <Button type="submit" variant="secondary" size="sm">
        Filter
      </Button>
      {hasAny ? (
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      ) : null}
    </form>
  );
}

/** A positive integer, or undefined for blank and for anything that is not one. */
function readId(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function SubmissionListHeader({ locale, currentPage, totalPages }: {
  locale: string;
  currentPage: number;
  totalPages: number;
}): React.JSX.Element {
  const dict = useDictionary();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`${buildRoute(locale, 'system.docs')}#submissions`} className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary" title={dict.docs.viewDocumentation}>
        <HelpCircle className="w-4 h-4" />
      </Link>
      <div className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  );
}

export function SubmissionList({ initialSubmissions, totalPages, currentPage, navigation, initialSort, filters = {} }: SubmissionListProps): React.JSX.Element {
  const [submissions] = useSyncedState(initialSubmissions);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useAppRouter();
  // Why the generated record label: the row action opens the submission record,
  // so its accessible name comes from the same bilingual key the record uses.
  const recordLabel = navigation.evaluation['submission-record'].label;

  const handlePageChange = (newPage: number): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', newPage.toString());
    router.push(url.toString());
  };

  const applySort = (next: ListSortInput): void => {
    const url = new URL(window.location.href);
    if (next !== null && next !== undefined) {
      url.searchParams.set('sort', next.key);
      url.searchParams.set('dir', next.direction);
    } else {
      url.searchParams.delete('sort');
      url.searchParams.delete('dir');
    }
    url.searchParams.set('page', '1');
    router.push(url.toString());
  };

  // Why page resets here too: page 4 of the unfiltered list is not page 4 of a narrowed
  // one, so keeping it would show an empty page that looks like "no matches".
  const applyFilters = (next: SubmissionFilters): void => {
    const url = new URL(window.location.href);
    for (const [key, value] of [
      ['contest', next.contestId],
      ['task', next.taskId],
      ['user', next.userId],
    ] as const) {
      if (value === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    url.searchParams.set('page', '1');
    router.push(url.toString());
  };

  return (
    <div className="space-y-6">
      <SubmissionListHeader locale={locale} currentPage={currentPage} totalPages={totalPages} />
      <SubmissionFiltersBar filters={filters} onApply={applyFilters} />
      <RecordList
        rows={submissions}
        columns={buildSubmissionColumns()}
        getRowKey={(submission) => submission.id}
        getRecordHref={(submission) => recordHref(locale, submission)}
        renderRowActions={(submission) => (
          <RowActionLink href={recordHref(locale, submission)} label={`${recordLabel} ${submission.id}`} icon={<Eye />} isPrimary />
        )}
        emptyState={
          <EmptyState icon={FileCode} title="No submissions found" description="Submissions will appear here once contestants start submitting." />
        }
        sort={initialSort}
        onSortChange={applySort}
      />
      <RecordListPager currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
    </div>
  );
}
