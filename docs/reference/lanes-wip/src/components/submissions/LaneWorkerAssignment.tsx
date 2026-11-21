'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { setEvaluationLaneWorker } from '@/app/actions/evaluationLanes';
import type { EvaluationWorkerSummary } from '@/app/actions/evaluationWorkers';
import { Button } from '@/components/core/Button';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import type { Dictionary } from '@/lib/dictionary';

const FIELD_CLASSES =
  'w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring';
const NO_WORKER_VALUE = '';

/**
 * Bind or unbind the worker a lane's submissions are routed to.
 *
 * WHY it owns its own reason field: every lane change is audited with a reason, and a worker
 * change is a routing decision an operator has to be able to explain afterwards.
 */
export function LaneWorkerAssignment({
  laneId,
  workerId,
  workers,
  labels,
}: {
  laneId: number;
  workerId: number | null;
  workers: readonly EvaluationWorkerSummary[];
  labels: Dictionary['submissions'];
}): React.ReactNode {
  const router = useRouter();
  const runAction = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [workerValue, setWorkerValue] = useState(workerId === null ? NO_WORKER_VALUE : String(workerId));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const nextWorkerId = workerValue === NO_WORKER_VALUE ? null : Number(workerValue);
      const outcome = await runAction(
        { pending: 'Binding lane worker…', success: 'Lane worker saved', failure: 'Lane worker save failed' },
        () => setEvaluationLaneWorker(laneId, nextWorkerId, reason.trim()),
      );
      if (outcome?.success) {
        setOpen(false);
        setReason('');
        router.refresh();
      } else if (outcome?.error !== undefined) {
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {labels.laneWorker}
      </Button>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        aria-label={labels.laneWorker}
        value={workerValue}
        onChange={(event) => setWorkerValue(event.target.value)}
        disabled={busy}
        className={FIELD_CLASSES}
      >
        <option value={NO_WORKER_VALUE}>{labels.laneWorkerAny}</option>
        {workers.map((worker) => (
          <option key={worker.id} value={worker.id}>
            {worker.name}{worker.connected ? '' : ` — ${labels.laneWorkerUnbound}`}
          </option>
        ))}
      </select>
      <textarea
        aria-label={labels.laneReason}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder={labels.laneReasonPlaceholder}
        disabled={busy}
        className={FIELD_CLASSES}
      />
      {error !== null && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="positive"
          size="sm"
          loading={busy}
          disabled={busy || reason.trim().length === 0}
          onClick={() => { void handleSave(); }}
        >
          {labels.laneMoveSubmit}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          {labels.laneCancel}
        </Button>
      </div>
    </div>
  );
}
