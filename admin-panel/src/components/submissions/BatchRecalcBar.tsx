'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import {
  previewBatchRecalculation,
  previewRecalculationByIds,
  recalculateSubmissionIds,
  recalculateSubmissions,
  setSubmissionOfficial,
  type BatchRecalcPreview,
  type BatchRecalcReport,
  type BatchRecalcScope,
  type RecalcType,
} from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { InlineAlert } from '@/components/core/InlineAlert';
import { ReasonDialog } from '@/components/core/ReasonDialog';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useDictionary } from '@/hooks/useDictionary';
import { useReasonPrompt, type ReasonActionResult } from '@/hooks/useReasonPrompt';
import type { Dictionary } from '@/lib/dictionary';
import { interpolate } from '@/lib/interpolate';
import type { SubmissionListItem } from '@/types';

import { watchSubmissionsForCompletion } from './SubmissionRequeueToasts';

const RECOMPUTE_KINDS: readonly RecalcType[] = ['score', 'evaluation', 'full'];

const FILTER_WIDE_FALLBACK_LABEL = 'Apply to all matching the filter';

function bulkLabel(dict: Dictionary, kind: RecalcType): string {
  const bulk = dict.submissions.bulk;
  if (kind === 'evaluation') return bulk.reevaluate;
  if (kind === 'full') return bulk.full;
  return bulk.rescore;
}

/** The blast-radius line the confirmations carry, with the match count appended. */
function filterWideDescription(base: string, preview: BatchRecalcPreview): string {
  if (preview.capped) {
    return `${base} This matches ${preview.matched} submissions; only the first ${preview.willProcess} will be requeued.`;
  }
  return `${base} This matches ${preview.willProcess} submission(s).`;
}

function selectionDescription(base: string, preview: BatchRecalcPreview): string {
  if (preview.capped) {
    return `${base} ${preview.matched} submission(s) are selected; only the first ${preview.willProcess} will be requeued.`;
  }
  return `${base} This runs on the ${preview.willProcess} selected submission(s).`;
}

function reportAlert(report: BatchRecalcReport): React.JSX.Element {
  if (report.error !== undefined) return <InlineAlert tone="destructive">{report.error}</InlineAlert>;
  const summary = `Requeued ${report.succeeded} of ${report.processed}.${report.failed > 0 ? ` ${report.failed} failed.` : ''}${report.capped ? ' More submissions matched than the batch limit.' : ''}`;
  return <InlineAlert tone={report.failed > 0 ? 'warning' : 'success'}>{summary}</InlineAlert>;
}

interface RecalculationFlowArgs {
  /** What this scope or selection would requeue, read fresh at the click that asks. */
  readonly preview: () => Promise<BatchRecalcPreview>;
  readonly execute: (kind: RecalcType, reason: string) => Promise<BatchRecalcReport>;
  readonly describe: (base: string, preview: BatchRecalcPreview) => string;
  readonly onSucceeded: () => void;
}

interface RecalculationFlow {
  readonly pending: RecalcType | null;
  readonly error: string | null;
  readonly report: BatchRecalcReport | null;
  readonly request: (kind: RecalcType) => void;
  readonly reasonDialog: React.JSX.Element;
}

/**
 * Preview-then-confirm for one requeue choice: the count is read at the click,
 * the confirmation carries the blast-radius copy, and the reason the server now
 * requires is collected in the same dialog that runs the action — the reason
 * arrives with the action it explains instead of gating a control nobody has
 * chosen yet.
 */
function useRecalculationFlow(args: RecalculationFlowArgs): RecalculationFlow {
  const dict = useDictionary();
  const { recalculateSubmissionConfirm } = useConfirmationCopy();
  const prompt = useReasonPrompt();
  const [pending, setPending] = useState<RecalcType | null>(null);
  const [report, setReport] = useState<BatchRecalcReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = async (kind: RecalcType, reason: string): Promise<ReasonActionResult> => {
    try {
      const result = await args.execute(kind, reason);
      setReport(result);
      if (result.error !== undefined) return { success: false, error: result.error };
      watchSubmissionsForCompletion(result.outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.submissionId));
      args.onSucceeded();
      return { success: true };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      const shown = message === '' ? dict.submissions.toasts.batchFailure : message;
      setError(shown);
      return { success: false, error: shown };
    }
  };

  const request = async (kind: RecalcType): Promise<void> => {
    setError(null);
    setReport(null);
    setPending(kind);
    try {
      const preview = await args.preview();
      const base = recalculateSubmissionConfirm(kind);
      prompt.ask({
        title: base.title,
        description: args.describe(base.description, preview),
        submitLabel: base.confirmLabel,
        run: (reason) => execute(kind, reason),
      });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setError(message === '' ? dict.submissions.toasts.batchFailure : message);
    } finally {
      setPending(null);
    }
  };

  return {
    pending,
    error,
    report,
    request,
    reasonDialog: <ReasonDialog request={prompt.request} onClose={prompt.close} onSubmit={prompt.submit} />,
  };
}

function RecomputeButtons({ flow }: { readonly flow: RecalculationFlow }): React.JSX.Element {
  const dict = useDictionary();
  return (
    <>
      {RECOMPUTE_KINDS.map((kind) => (
        <Button
          key={kind}
          variant={kind === 'full' ? 'negativeOutline' : 'secondary'}
          size="sm"
          disabled={flow.pending !== null}
          onClick={() => {
            void flow.request(kind);
          }}
        >
          {flow.pending === kind ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {kind === 'full' ? <AlertTriangle className="w-3 h-3" aria-hidden /> : null}
          {bulkLabel(dict, kind)}
        </Button>
      ))}
    </>
  );
}

export interface BatchRecalcBarProps {
  /** The filter the list is showing. The batch operates on exactly this scope. */
  readonly scope: BatchRecalcScope;
  /** Whether the reader holds every gate key, resolved server-side. */
  readonly canRecompute: boolean;
}

/**
 * Requeue every submission the current filter matches.
 *
 * WHY preview-then-confirm rather than one button: this is the most destructive control
 * in the panel — it discards existing evaluations for everything it touches. "I re-ran the
 * whole contest by accident" is the failure mode, and a count before the commit is the
 * cheapest defence against it.
 *
 * WHY a single muted link rather than a second card: the selection bar above owns the
 * page's primary batch actions, so the filter-wide run stays reachable as the fallback
 * behind one line instead of competing with the toolbar for attention.
 */
export function BatchRecalcBar({ scope, canRecompute }: BatchRecalcBarProps): React.JSX.Element | null {
  const dict = useDictionary();
  const router = useAppRouter();
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const { contestId, taskId, userId } = scope;

  useEffect(() => {
    if (!canRecompute) return;
    let stale = false;
    const batchScope: BatchRecalcScope = {
      ...(contestId === undefined ? {} : { contestId }),
      ...(taskId === undefined ? {} : { taskId }),
      ...(userId === undefined ? {} : { userId }),
    };
    previewBatchRecalculation(batchScope)
      .then((preview) => {
        if (!stale) setCount(preview.matched);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [canRecompute, contestId, taskId, userId]);

  const flow = useRecalculationFlow({
    preview: () => previewBatchRecalculation(scope),
    execute: (kind, reason) => recalculateSubmissions(scope, kind, { reason }),
    describe: filterWideDescription,
    onSucceeded: () => router.refresh(),
  });

  if (!canRecompute) return null;

  const linkLabel = count === null
    ? FILTER_WIDE_FALLBACK_LABEL
    : interpolate(dict.submissions.bulk.applyToFilter, { count });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="px-1 text-muted-foreground underline-offset-4 hover:underline"
        aria-expanded={expanded}
        aria-controls={expanded ? 'submission-filter-wide-recalc' : undefined}
        onClick={() => setExpanded((open) => !open)}
      >
        {linkLabel}
      </Button>
      {expanded ? (
        <div id="submission-filter-wide-recalc" className="flex flex-wrap items-center gap-2">
          <RecomputeButtons flow={flow} />
        </div>
      ) : null}
      {flow.error !== null ? <InlineAlert tone="destructive">{flow.error}</InlineAlert> : null}
      {flow.report !== null ? reportAlert(flow.report) : null}
      {flow.reasonDialog}
    </div>
  );
}

export interface SubmissionBulkActionsProps {
  readonly submissionIds: readonly number[];
  readonly submissions: readonly SubmissionListItem[];
  readonly canRecalculate: boolean;
  readonly canOfficial: boolean;
  readonly onSucceeded: () => void;
}

/**
 * The actions the selection bar hosts: the three requeue kinds over exactly the
 * checked ids, plus the official flag as one atomic set — it sets rather than
 * toggles, because a mixed selection has no single correct flip.
 */
export function SubmissionBulkActions({
  submissionIds,
  submissions,
  canRecalculate,
  canOfficial,
  onSucceeded,
}: SubmissionBulkActionsProps): React.JSX.Element | null {
  const dict = useDictionary();
  const toasts = dict.submissions.toasts;
  const confirm = useConfirm();
  const { toggleOfficialConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();
  const [pendingOfficial, setPendingOfficial] = useState(false);

  const flow = useRecalculationFlow({
    preview: () => previewRecalculationByIds(submissionIds),
    execute: (kind, reason) => recalculateSubmissionIds(submissionIds, kind, { reason }),
    describe: selectionDescription,
    onSucceeded,
  });

  const selected = useMemo(() => new Set(submissionIds), [submissionIds]);
  const selectedRows = submissions.filter((submission) => selected.has(submission.id));
  const targetOfficial = !selectedRows.every((submission) => submission.official);
  const affected = selectedRows.filter((submission) => submission.official !== targetOfficial).length;

  const runOfficial = async (): Promise<void> => {
    const copy = toggleOfficialConfirm();
    const description = `${copy.description} ${affected} of the ${submissionIds.length} selected submission(s) will change.`;
    if (!(await confirm({ ...copy, description }))) return;
    setPendingOfficial(true);
    try {
      const outcome = await runAction(
        { pending: toasts.officialPending, success: toasts.officialSuccess, failure: toasts.officialFailure },
        () => setSubmissionOfficial(submissionIds, targetOfficial),
      );
      if (outcome?.success) onSucceeded();
    } finally {
      setPendingOfficial(false);
    }
  };

  if (!canRecalculate && !canOfficial) return null;

  return (
    <>
      {canRecalculate ? <RecomputeButtons flow={flow} /> : null}
      {canOfficial ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pendingOfficial || flow.pending !== null || affected === 0}
          onClick={() => {
            void runOfficial();
          }}
        >
          {pendingOfficial ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {targetOfficial ? dict.submissions.bulk.official : dict.submissions.actions.clearOfficial}
        </Button>
      ) : null}
      {flow.error !== null ? (
        <div className="w-full">
          <InlineAlert tone="destructive">{flow.error}</InlineAlert>
        </div>
      ) : null}
      {flow.report !== null ? <div className="w-full">{reportAlert(flow.report)}</div> : null}
      {flow.reasonDialog}
    </>
  );
}
