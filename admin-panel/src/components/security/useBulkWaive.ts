'use client';

import { useState, useTransition } from 'react';

import { bulkWaiveUnreachable } from '@/app/actions/securityPatching';
import type { Dictionary } from '@/lib/dictionary';
import type { BulkWaiveResult } from '@/lib/panel-actions/patching-bulk-waive';

export type BulkWaiveCopy = Dictionary['security']['patching']['bulkWaive'];

/** The dialog's state machine, kept out of the JSX so neither half outgrows a readable length. */
export interface BulkWaiveController {
  readonly reviewBy: string;
  readonly plan: BulkWaiveResult | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly setReviewBy: (value: string) => void;
  readonly preview: () => void;
  readonly apply: () => void;
  readonly reset: () => void;
}

interface WaiverState {
  readonly reviewBy: string;
  readonly plan: BulkWaiveResult | null;
  readonly error: string | null;
}

const EMPTY: WaiverState = { reviewBy: '', plan: null, error: null };

/** What the page says after a run: both numbers, because a run that refused rows is not a clean one. */
export function recordedMessage(copy: BulkWaiveCopy, result: BulkWaiveResult): string {
  return copy.applied
    .replace('{waived}', String(result.counts.waived))
    .replace('{refused}', String(result.counts.refusedReachable + result.counts.refusedUnknown));
}

interface OutcomeHandlers {
  readonly fail: (error: string) => void;
  readonly preview: (plan: BulkWaiveResult) => void;
  readonly applied: (result: BulkWaiveResult) => void;
}

/** One call to the action, routed by what came back: a refusal, a dry run, or a written plan. */
async function execute(
  input: {
    readonly reviewBy: string;
    readonly dryRun: boolean;
    readonly copy: BulkWaiveCopy;
    readonly expectedWaivers?: number;
  },
  handlers: OutcomeHandlers,
): Promise<void> {
  const result = await bulkWaiveUnreachable({
    reviewBy: input.reviewBy,
    dryRun: input.dryRun,
    ...(input.expectedWaivers === undefined ? {} : { expectedWaivers: input.expectedWaivers }),
  });
  if (!result.success) return handlers.fail(result.error ?? (input.dryRun ? input.copy.previewFailed : input.copy.failed));
  if (input.dryRun) return handlers.preview(result);
  handlers.applied(result);
}

/**
 * Preview then apply, over the one server action.
 *
 * WHY both steps call the same action: the plan an operator confirms is the plan that runs, so the
 * dry run is not a second implementation to keep in step — only `dryRun` differs.
 */
export function useBulkWaive(
  copy: BulkWaiveCopy,
  onRecorded: (message: string) => void,
  onClose: () => void,
): BulkWaiveController {
  const [state, setState] = useState<WaiverState>(EMPTY);
  const [pending, startTransition] = useTransition();

  function setReviewBy(value: string): void {
    // A plan computed for another date is not the plan the confirm button would run.
    setState({ reviewBy: value, plan: null, error: null });
  }

  function run(dryRun: boolean): void {
    if (state.reviewBy.trim() === '') {
      setState((current) => ({ ...current, error: copy.reviewRequired }));
      return;
    }
    startTransition(async () => {
      await execute(
        { reviewBy: state.reviewBy, dryRun, copy, expectedWaivers: dryRun ? undefined : state.plan?.counts.planned },
        {
          fail: (error) => setState((current) => ({ ...current, error })),
          preview: (plan) => setState((current) => ({ ...current, plan, error: null })),
          applied: (result) => {
            onRecorded(recordedMessage(copy, result));
            setState(EMPTY);
            onClose();
          },
        },
      );
    });
  }

  return { ...state, pending, setReviewBy, preview: () => run(true), apply: () => run(false), reset: () => setState(EMPTY) };
}
