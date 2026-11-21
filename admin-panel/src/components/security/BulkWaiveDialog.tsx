'use client';

import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import type { Dictionary } from '@/lib/dictionary';
import type { BulkWaiveResult } from '@/lib/panel-actions/patching-bulk-waive';
import { useBulkWaive, type BulkWaiveController, type BulkWaiveCopy } from './useBulkWaive';

type PatchingCopy = Dictionary['security']['patching'];

interface BulkWaiveDialogProps {
  readonly open: boolean;
  readonly copy: PatchingCopy;
  readonly onClose: () => void;
  /** The page's own feedback line: the run closes the dialog, so the numbers have to travel. */
  readonly onRecorded: (message: string) => void;
}

function CountLine({ label, value }: { readonly label: string; readonly value: number }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{String(value)}</dd>
    </div>
  );
}

/**
 * The plan as the operator confirms it: the four numbers, then every refused row named.
 *
 * WHY the refusals are listed and not only counted: "12 refused" is a reassurance nobody can check.
 * The keys say which CVEs stayed live and why, which is the whole point of refusing out loud.
 */
function PlanView({ copy, plan }: { readonly copy: BulkWaiveCopy; readonly plan: BulkWaiveResult }): React.JSX.Element {
  const counts = plan.counts;
  return (
    <div className="space-y-3">
      <dl className="space-y-1 rounded-md border border-border p-3">
        <CountLine label={copy.candidates} value={counts.candidates} />
        <CountLine label={copy.planned} value={counts.planned} />
        <CountLine label={copy.findingsWaived} value={counts.findingsWaived} />
        <CountLine label={copy.refusedReachable} value={counts.refusedReachable} />
        <CountLine label={copy.refusedUnknown} value={counts.refusedUnknown} />
        <CountLine label={copy.alreadyWaived} value={counts.alreadyWaived} />
      </dl>
      {plan.refusals.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{copy.refusalsTitle}</p>
          <ul className="max-h-40 space-y-0.5 overflow-auto rounded-md border border-border p-2">
            {plan.refusals.map((refusal) => (
              <li key={refusal.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-mono">{refusal.key}</span>
                <span className="shrink-0 text-muted-foreground">
                  {refusal.verdict === 'reachable' ? copy.refusedReachable : copy.refusedUnknown}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {counts.planned === 0 && <p className="text-sm text-muted-foreground">{copy.nothing}</p>}
    </div>
  );
}

/** The three presses: leave, preview the plan, or write the plan the preview showed. */
function Actions({
  copy,
  bulk,
  controller,
  close,
}: {
  readonly copy: PatchingCopy;
  readonly bulk: BulkWaiveCopy;
  readonly controller: BulkWaiveController;
  readonly close: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onClick={close} disabled={controller.pending}>
        {copy.cancel}
      </Button>
      <Button variant="secondary" loading={controller.pending} onClick={controller.preview}>
        {bulk.preview}
      </Button>
      <Button
        loading={controller.pending}
        disabled={controller.plan === null || controller.plan.counts.planned === 0}
        onClick={controller.apply}
      >
        {bulk.confirm.replace('{count}', String(controller.plan?.counts.planned ?? 0))}
      </Button>
    </div>
  );
}

/**
 * The bulk waiver, as one confirmation.
 *
 * WHY the confirm label counts what it will write: the button is the last chance to notice that the
 * dialog is about 479 decisions and not one, and the number comes from the plan that was previewed.
 */
export function BulkWaiveDialog({ open, copy, onClose, onRecorded }: BulkWaiveDialogProps): React.JSX.Element {
  const bulk = copy.bulkWaive;
  const controller = useBulkWaive(bulk, onRecorded, onClose);
  const close = (): void => {
    controller.reset();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={bulk.title}
      description={bulk.description}
      pending={controller.pending}
      footer={<Actions copy={copy} bulk={bulk} controller={controller} close={close} />}
    >
      <div className="space-y-3">
        <Input
          label={bulk.reviewByLabel}
          type="date"
          value={controller.reviewBy}
          onChange={(event) => controller.setReviewBy(event.target.value)}
          required
        />
        {controller.error !== null && <p className="text-sm text-destructive">{controller.error}</p>}
        {controller.plan === null ? (
          <p className="text-sm text-muted-foreground">{bulk.previewHint}</p>
        ) : (
          <PlanView copy={bulk} plan={controller.plan} />
        )}
      </div>
    </Dialog>
  );
}
