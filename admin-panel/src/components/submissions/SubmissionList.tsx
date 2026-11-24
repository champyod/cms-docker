'use client';

import { BadgeCheck, Eye, FileCode, RefreshCw } from 'lucide-react';
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
import type { SubmissionFilters } from './SubmissionFiltersCard';
import { SubmissionRequeueToasts, watchSubmissionsForCompletion } from './SubmissionRequeueToasts';

export type { SubmissionFilters };

export interface SubmissionListProps {
  readonly initialSubmissions: readonly SubmissionListItem[];
  readonly navigation: Dictionary['navigation'];
  readonly initialSort?: ListSortInput;
  /** Absent means everything, not nothing. */
  readonly filters?: SubmissionFilters;
  /** Resolved on the server from the same keys the requeue paths gate on. */
  readonly canRecalculate?: boolean;
  /** Resolved from submission:update, the key the official flag re-checks on every call. */
  readonly canOfficial?: boolean;
  /** Resolved from submission:update, the key the bulk comment actions re-check. */
  readonly canComment?: boolean;
}

function recordHref(locale: string, submission: SubmissionListItem): string {
  return buildRoute(locale, 'evaluation.submission-record', { id: submission.id });
}

// The desktop row and the mobile card render the same cluster, so the size target is shared.
const ROW_ACTION_TARGET = 'min-h-11 min-w-11';

/** The range applies on pointer-down so the end row's own toggle cannot fight it. */
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

export function SubmissionList({ initialSubmissions, navigation, initialSort, filters = {}, canRecalculate = false, canOfficial = false, canComment = false }: SubmissionListProps): React.JSX.Element {
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
  // The row action opens the record, so its accessible name comes from the record's own key.
  const recordLabel = navigation.evaluation['submission-record'].label;

  const submissionIds = submissions.map((submission) => submission.id);
  const selection = useListSelection('submissions.list', submissionIds);
  const [shiftRangeApplied, setShiftRangeApplied] = useState(false);

  const openRecord = (submission: SubmissionListItem): void => {
    router.push(recordHref(locale, submission));
  };

  // The server requires a justification on every requeue, so the dialog collects it.
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
    ...buildSubmissionColumns(dict.common.notSet),
  ];

  // Page 4 of one order is not page 4 of another, so the sort resets the number.
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
      {canRecalculate || canOfficial || canComment ? (
        <BulkActionBar selectedCount={selection.selectedCount} countLabel={dict.states.selection.count} clearLabel={dict.states.selection.clear} onClear={selection.clear}>
          <SubmissionBulkActions
            submissionIds={[...selection.selectedIds]}
            submissions={submissions}
            canRecalculate={canRecalculate}
            canOfficial={canOfficial}
            canComment={canComment}
            onSucceeded={() => router.refresh()}
          />
        </BulkActionBar>
      ) : null}
      <BatchRecalcBar
        scope={{ contestId: filters.contestId, taskId: filters.taskId, userId: filters.userId }}
        canRecompute={canRecalculate}
        canComment={canComment}
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
      <ReasonDialog request={reasonPrompt.request} onClose={reasonPrompt.close} onSubmit={reasonPrompt.submit} />
      <SubmissionRequeueToasts submissions={submissions} />
    </div>
  );
}
