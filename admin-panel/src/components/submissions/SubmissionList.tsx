'use client';

import { BadgeCheck, Eye, FileCode, HelpCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useState } from 'react';

import { recalculateSubmission, toggleSubmissionOfficial } from '@/app/actions/submissions';
import { BulkActionBar } from '@/components/core/BulkActionBar';
import { EmptyState } from '@/components/core/EmptyState';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import type { ResponsiveColumn } from '@/components/core/ResponsiveTable';
import { RowActions } from '@/components/core/RowActions';
import { buildSelectionColumn } from '@/components/core/SelectionColumn';
import { RecordList } from '@/components/list/RecordList';
import { RecordListPager } from '@/components/list/RecordListPager';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { useListSelection } from '@/hooks/useListSelection';
import { useReasonPrompt } from '@/hooks/useReasonPrompt';
import { useSyncedState } from '@/hooks/useSyncedState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { ListSortInput } from '@/lib/list-sorting';
import type { SubmissionListItem } from '@/types';

import { buildSubmissionColumns } from './submissionColumns';
import { BatchRecalcBar, SubmissionBulkActions } from './BatchRecalcBar';
import { SubmissionFiltersCard, type SubmissionFilters } from './SubmissionFiltersCard';
import { SubmissionRequeueToasts, watchSubmissionsForCompletion } from './SubmissionRequeueToasts';

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

/**
 * The checkbox cell of a selectable column, with the shift-range wiring around it:
 * the range is applied on pointer-down so the end row's own toggle cannot fight it,
 * and the click that follows is cancelled only when a range was actually taken.
 */
function withShiftSelection(
  column: ResponsiveColumn<SubmissionListItem>,
  onSelectorPointerDown: (event: React.PointerEvent<HTMLSpanElement>, submission: SubmissionListItem) => void,
  onSelectorClickCapture: (event: React.MouseEvent<HTMLSpanElement>) => void,
): ResponsiveColumn<SubmissionListItem> {
  return {
    ...column,
    render: (submission) => (
      <span
        onPointerDown={(event) => onSelectorPointerDown(event, submission)}
        onClickCapture={onSelectorClickCapture}
      >
        {column.render(submission)}
      </span>
    ),
  };
}

export function SubmissionList({ initialSubmissions, totalPages, currentPage, navigation, initialSort, filters = {}, canRecalculate = false, canOfficial = false }: SubmissionListProps): React.JSX.Element {
  const [submissions] = useSyncedState(initialSubmissions);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useAppRouter();
  const confirm = useConfirm();
  const runAction = useActionFeedback();
  const dict = useDictionary();
  const toasts = dict.submissions.toasts;
  const { recalculateSubmissionConfirm, toggleOfficialConfirm } = useConfirmationCopy();
  const reasonPrompt = useReasonPrompt();
  const [pendingRejudge, setPendingRejudge] = useState<number | null>(null);
  // Why the generated record label: the row action opens the submission record,
  // so its accessible name comes from the same bilingual key the record uses.
  const recordLabel = navigation.evaluation['submission-record'].label;

  const submissionIds = submissions.map((submission) => submission.id);
  const selection = useListSelection('submissions.list', submissionIds);
  const [shiftRangeApplied, setShiftRangeApplied] = useState(false);

  const openRecord = (submission: SubmissionListItem): void => {
    router.push(recordHref(locale, submission));
  };

  // Why the reason dialog instead of a bare confirm: the server requires the
  // justification on every requeue, and the dialog that collects it carries the
  // same confirmation copy the single-submission control has always shown.
  const rejudge = (submissionId: number): void => {
    const base = recalculateSubmissionConfirm('score');
    reasonPrompt.ask({
      title: base.title,
      description: base.description,
      submitLabel: base.confirmLabel,
      run: async (reason) => {
        setPendingRejudge(submissionId);
        try {
          const outcome = await runAction(
            { pending: toasts.recomputePending, success: toasts.recomputeSuccess, failure: toasts.recomputeFailure },
            () => recalculateSubmission(submissionId, 'score', { reason }),
          );
          if (outcome === null) return { success: false };
          if (outcome.success) {
            watchSubmissionsForCompletion([submissionId]);
            router.refresh();
          }
          return outcome;
        } finally {
          setPendingRejudge(null);
        }
      },
    });
  };

  const toggleOfficial = async (submissionId: number): Promise<void> => {
    if (!(await confirm(toggleOfficialConfirm()))) return;
    const outcome = await runAction(
      { pending: toasts.officialPending, success: toasts.officialSuccess, failure: toasts.officialFailure },
      () => toggleSubmissionOfficial(submissionId),
    );
    if (outcome?.success) router.refresh();
  };

  const handleSelectorPointerDown = (
    event: React.PointerEvent<HTMLSpanElement>,
    submission: SubmissionListItem,
  ): void => {
    setShiftRangeApplied(false);
    if (!event.shiftKey || selection.anchorId === null) return;
    setShiftRangeApplied(selection.toggleRange(selection.anchorId, submission.id));
  };

  const handleSelectorClickCapture = (event: React.MouseEvent<HTMLSpanElement>): void => {
    const rangeTaken = shiftRangeApplied && event.shiftKey;
    setShiftRangeApplied(false);
    if (rangeTaken) event.preventDefault();
  };

  const toggleOneRespectingShift = (id: number, checked: boolean): void => {
    if (shiftRangeApplied) return;
    selection.toggleOne(id, checked);
  };

  const columns: ResponsiveColumn<SubmissionListItem>[] = [
    withShiftSelection(
      buildSelectionColumn<SubmissionListItem>({
        getRowId: (submission) => submission.id,
        selectedIds: selection.selectedIds,
        allSelected: selection.allSelected,
        partlyChecked: selection.someSelected,
        selectAllLabel: 'Select all submissions',
        selectRowLabel: (submission) => `Select submission ${submission.id}`,
        onToggleAll: selection.toggleAll,
        onToggleOne: toggleOneRespectingShift,
      }),
      handleSelectorPointerDown,
      handleSelectorClickCapture,
    ),
    ...buildSubmissionColumns(),
  ];

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
          onClick: () => rejudge(submission.id),
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
      {canRecalculate || canOfficial ? (
        <BulkActionBar selectedCount={selection.selectedCount} onClear={selection.clear}>
          <SubmissionBulkActions
            submissionIds={[...selection.selectedIds]}
            submissions={submissions}
            canRecalculate={canRecalculate}
            canOfficial={canOfficial}
            onSucceeded={() => router.refresh()}
          />
        </BulkActionBar>
      ) : null}
      <BatchRecalcBar
        scope={{ contestId: filters.contestId, taskId: filters.taskId, userId: filters.userId }}
        canRecompute={canRecalculate}
      />
      <RecordList
        rows={submissions}
        columns={columns}
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
      <ReasonDialog request={reasonPrompt.request} onClose={reasonPrompt.close} onSubmit={reasonPrompt.submit} />
      <SubmissionRequeueToasts submissions={submissions} />
    </div>
  );
}
