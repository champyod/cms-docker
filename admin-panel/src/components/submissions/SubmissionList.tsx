'use client';

import { BadgeCheck, Eye, FileCode, HelpCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useState } from 'react';

import { recalculateSubmission, toggleSubmissionOfficial } from '@/app/actions/submissions';
import { EmptyState } from '@/components/core/EmptyState';
import { RowActions } from '@/components/core/RowActions';
import { RecordList } from '@/components/list/RecordList';
import { RecordListPager } from '@/components/list/RecordListPager';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { useSyncedState } from '@/hooks/useSyncedState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { ListSortInput } from '@/lib/list-sorting';
import type { SubmissionListItem } from '@/types';

import { buildSubmissionColumns } from './submissionColumns';
import { BatchRecalcBar } from './BatchRecalcBar';
import { SubmissionFiltersCard, type SubmissionFilters } from './SubmissionFiltersCard';

export type { SubmissionFilters };

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
  /**
   * Whether the reader may requeue, single or in bulk. Resolved on the server from the
   * same four keys both requeue paths gate on, so neither control can appear to someone
   * the action would refuse.
   */
  readonly canRecalculate?: boolean;
  /**
   * Whether the reader may flip the official flag. Resolved from `submission:update`, the
   * key `toggleSubmissionOfficial` re-checks on every call.
   */
  readonly canOfficial?: boolean;
}

function recordHref(locale: string, submission: SubmissionListItem): string {
  return buildRoute(locale, 'evaluation.submission-record', { id: submission.id });
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

// Why one fragment for the size: the desktop row and the mobile card render the same
// cluster, so a per-layout target would drift the two apart.
const ROW_ACTION_TARGET = 'min-h-11 min-w-11';

export function SubmissionList({ initialSubmissions, totalPages, currentPage, navigation, initialSort, filters = {}, canRecalculate = false, canOfficial = false }: SubmissionListProps): React.JSX.Element {
  const [submissions] = useSyncedState(initialSubmissions);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useAppRouter();
  const confirm = useConfirm();
  const runAction = useActionFeedback();
  const { recalculateSubmissionConfirm, toggleOfficialConfirm } = useConfirmationCopy();
  const [pendingRejudge, setPendingRejudge] = useState<number | null>(null);
  // Why the generated record label: the row action opens the submission record,
  // so its accessible name comes from the same bilingual key the record uses.
  const recordLabel = navigation.evaluation['submission-record'].label;

  const openRecord = (submission: SubmissionListItem): void => {
    router.push(recordHref(locale, submission));
  };

  // Why the record's own copy: the list and the record run the same action, so an
  // operator sees one wording for it wherever they invoke it.
  const rejudge = async (submissionId: number): Promise<void> => {
    if (!(await confirm(recalculateSubmissionConfirm('score')))) return;
    setPendingRejudge(submissionId);
    try {
      const outcome = await runAction(
        { pending: 'Recalculating...', success: 'Submission queued for recalculation', failure: 'Recalculation failed' },
        () => recalculateSubmission(submissionId),
      );
      if (outcome?.success) router.refresh();
    } finally {
      setPendingRejudge(null);
    }
  };

  const toggleOfficial = async (submissionId: number): Promise<void> => {
    if (!(await confirm(toggleOfficialConfirm()))) return;
    const outcome = await runAction(
      { pending: 'Saving official flag...', success: 'Official flag saved', failure: 'Official flag update failed' },
      () => toggleSubmissionOfficial(submissionId),
    );
    if (outcome?.success) router.refresh();
  };

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
    const narrowing: readonly (readonly [string, string | number | undefined])[] = [
      ['contest', next.contestId],
      ['task', next.taskId],
      ['user', next.userId],
      ['search', next.search],
    ];
    for (const [key, value] of narrowing) {
      if (value === undefined || value === '') url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    }
    url.searchParams.set('page', '1');
    router.push(url.toString());
  };

  const renderRowActions = (submission: SubmissionListItem): React.JSX.Element => (
    <RowActions
      ariaLabel="Submission actions"
      primaryActionKey="view"
      actions={[
        { key: 'view', label: 'View', ariaLabel: `${recordLabel} ${submission.id}`, icon: Eye, onClick: () => openRecord(submission), className: ROW_ACTION_TARGET },
        {
          key: 'rejudge',
          label: 'Rejudge',
          ariaLabel: `Rejudge submission ${submission.id}`,
          icon: RefreshCw,
          onClick: () => { void rejudge(submission.id); },
          showWhen: canRecalculate,
          loading: pendingRejudge === submission.id,
          disabled: pendingRejudge !== null,
          className: ROW_ACTION_TARGET,
        },
        {
          key: 'official',
          label: submission.official ? 'Clear official' : 'Mark official',
          ariaLabel: `${submission.official ? 'Clear' : 'Mark'} submission ${submission.id} official`,
          icon: BadgeCheck,
          onClick: () => { void toggleOfficial(submission.id); },
          showWhen: canOfficial,
          className: ROW_ACTION_TARGET,
        },
      ]}
    />
  );

  return (
    <div className="space-y-6">
      <SubmissionListHeader locale={locale} currentPage={currentPage} totalPages={totalPages} />
      <SubmissionFiltersCard filters={filters} onApply={applyFilters} />
      <BatchRecalcBar
        scope={{ contestId: filters.contestId, taskId: filters.taskId, userId: filters.userId }}
        canRecompute={canRecalculate}
      />
      <RecordList
        rows={submissions}
        columns={buildSubmissionColumns()}
        getRowKey={(submission) => submission.id}
        getRecordHref={(submission) => recordHref(locale, submission)}
        renderRowActions={renderRowActions}
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
