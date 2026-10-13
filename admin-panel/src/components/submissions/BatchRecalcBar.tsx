'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  previewBatchRecalculation,
  recalculateSubmissions,
  type BatchRecalcReport,
  type BatchRecalcScope,
} from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Text } from '@/components/core/Typography';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';

type RecomputeKind = 'score' | 'evaluation' | 'full';

const RECOMPUTE_CHOICES: readonly { kind: RecomputeKind; label: string }[] = [
  { kind: 'score', label: 'Rescore all' },
  { kind: 'evaluation', label: 'Re-evaluate all' },
  { kind: 'full', label: 'Full re-run all' },
];

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
 * WHY the scope comes from the list's own filter: an operator who has narrowed the list
 * to one task has already expressed the intent, so re-entering the scope in a dialog
 * would be a second chance to disagree with themselves.
 */
export function BatchRecalcBar({ scope, canRecompute }: BatchRecalcBarProps): React.JSX.Element | null {
  const confirm = useConfirm();
  const { recalculateSubmissionConfirm } = useConfirmationCopy();
  const [pending, setPending] = useState<RecomputeKind | null>(null);
  const [report, setReport] = useState<BatchRecalcReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canRecompute) return null;

  const run = async (kind: RecomputeKind): Promise<void> => {
    setError(null);
    setReport(null);
    setPending(kind);
    try {
      // Why the preview is re-read here rather than trusted from a previous render: the
      // count can change between painting the button and clicking it, and the operator
      // must confirm the number they are actually about to commit.
      const preview = await previewBatchRecalculation(scope);
      const base = recalculateSubmissionConfirm(kind);
      // Why the count is appended to the shared copy rather than a new string: the tone
      // and labels of this confirmation are the same ones the single-submission control
      // uses, and only the blast radius differs.
      const description = preview.capped
        ? `${base.description} This matches ${preview.matched} submissions; only the first ${preview.willProcess} will be requeued.`
        : `${base.description} This matches ${preview.willProcess} submission(s).`;
      if (!(await confirm({ ...base, description }))) return;

      setReport(await recalculateSubmissions(scope, kind));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <Text as="p" variant="small" className="text-muted-foreground">
        Applies to every submission the filter above matches.
      </Text>
      <div className="flex flex-wrap items-center gap-2">
        {RECOMPUTE_CHOICES.map(({ kind, label }) => (
          <Button
            key={kind}
            variant={kind === 'full' ? 'negativeOutline' : 'secondary'}
            size="sm"
            onClick={() => {
              void run(kind);
            }}
            disabled={pending !== null}
          >
            {pending === kind && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {label}
          </Button>
        ))}
      </div>
      {error !== null ? <InlineAlert tone="destructive">{error}</InlineAlert> : null}
      {report !== null ? (
        <InlineAlert tone={report.failed > 0 ? 'warning' : 'success'}>
          {`Requeued ${report.succeeded} of ${report.processed}.${report.failed > 0 ? ` ${report.failed} failed.` : ''}${report.capped ? ' More submissions matched than the batch limit.' : ''}`}
        </InlineAlert>
      ) : null}
    </div>
  );
}
