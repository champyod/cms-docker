'use client';

import { useEffect, useState } from 'react';

import { getTaskDatasets } from '@/app/actions/tasks';
import { recalculateSubmission } from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { Input } from '@/components/core/Input';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';

import { queueForWorker, setSubmissionQueue } from './submission-queue-store';

export type RecomputeKind = 'score' | 'evaluation' | 'full';

interface RecomputeArgs {
  readonly kind: RecomputeKind;
  readonly reason: string;
  readonly datasetId: number | null;
}

interface DatasetOption {
  readonly id: number;
  readonly isActive: boolean;
}

export interface RecomputeDialogController {
  readonly dialog: React.JSX.Element | null;
  readonly ask: (kind: RecomputeKind) => void;
}

const RPC_TIMEOUT_MESSAGE = 'Evaluation service did not respond in time';
const SELECT_SURFACE = 'flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
const REASON_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function isRpcTimeout(outcome: { timedOut?: boolean; error?: string }): boolean {
  return outcome.timedOut === true || outcome.error === RPC_TIMEOUT_MESSAGE;
}

function useTaskDatasets(kind: RecomputeKind | null, taskId: number | null): {
  readonly options: readonly DatasetOption[];
  readonly loaded: boolean;
  readonly selected: number | '';
  readonly select: (value: number | '') => void;
} {
  const [options, setOptions] = useState<readonly DatasetOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<number | ''>('');

  useEffect(() => {
    if (kind === null || loaded || taskId === null) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const data = await getTaskDatasets(taskId);
        if (cancelled) return;
        const options = (data?.datasets ?? []).map((dataset) => ({
          id: dataset.id,
          isActive: dataset.id === data?.activeDatasetId,
        }));
        setOptions(options);
        setSelected(options.find((option) => option.isActive)?.id ?? options[0]?.id ?? '');
      } catch {
        // A reader without task:read/dataset:read degrades to the server's own dataset resolution.
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, loaded, taskId]);

  return { options, loaded, selected, select: setSelected };
}

export function useRecomputeDialog({ submissionId, taskId }: {
  readonly submissionId: number;
  readonly taskId: number | null;
}): RecomputeDialogController {
  const dictionary = useDictionary();
  const confirmations = dictionary.confirmations;
  const record = dictionary.submissions.record;
  const runAction = useActionFeedback();
  const router = useAppRouter();
  const [kind, setKind] = useState<RecomputeKind | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const datasets = useTaskDatasets(kind, taskId);

  const ask = (next: RecomputeKind): void => {
    setReason('');
    setTyped('');
    setKind(next);
  };

  const close = (): void => {
    setKind(null);
    setReason('');
    setTyped('');
  };

  const execute = async (args: RecomputeArgs): Promise<void> => {
    const options = { reason: args.reason, ...(args.datasetId === null ? {} : { datasetId: args.datasetId }) };
    setRunning(true);
    try {
      const outcome = await runAction(
        {
          pending: record.toasts.recomputePending,
          success: record.toasts.recomputeQueued,
          failure: record.toasts.recomputeFailed,
        },
        () => recalculateSubmission(submissionId, args.kind, options),
      );
      if (outcome === null) return;
      if (outcome.success) {
        queueForWorker();
        router.refresh();
        close();
        return;
      }
      if (isRpcTimeout(outcome)) {
        setSubmissionQueue({ kind: 'timeout', retry: () => execute(args) });
        close();
      }
    } finally {
      setRunning(false);
    }
  };

  const datasetLabel = (): string | null => {
    const option = datasets.options.find((entry) => entry.id === datasets.selected);
    if (option === undefined) return null;
    const name = interpolate(record.results.dataset, { id: option.id });
    return option.isActive ? name + ' · ' + record.recompute.activeDefault : name;
  };

  const title = (): string => {
    if (kind === 'full') return interpolate(record.rerunTyped.title, { id: submissionId });
    return interpolate(confirmations.recalculate.title, {
      type: confirmations.recalculate.types[kind ?? 'score'],
    });
  };

  const description = (): string => {
    const dataset = datasetLabel();
    if (dataset !== null) return interpolate(confirmations.recalculate.descriptionDataset, { dataset });
    return kind === 'full' ? record.rerunTyped.description : confirmations.recalculate.description;
  };

  const matchesTyped = typed.trim() === String(submissionId);
  const canRun = reason.trim() !== '' && (kind !== 'full' || matchesTyped) && !running;

  const run = (): void => {
    void execute({
      kind: kind ?? 'score',
      reason: reason.trim(),
      datasetId: datasets.selected === '' ? null : datasets.selected,
    });
  };

  const dialog = kind === null ? null : (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !running) close();
      }}
      title={title()}
      description={description()}
      pending={running}
    >
      <div className="space-y-3">
        {datasets.loaded && datasets.options.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="submission-recompute-dataset" className="text-sm font-medium text-foreground ml-1">
              {record.recompute.datasetLabel}
            </label>
            <select
              id="submission-recompute-dataset"
              className={SELECT_SURFACE}
              value={datasets.selected}
              disabled={running}
              onChange={(event) => datasets.select(event.target.value === '' ? '' : Number(event.target.value))}
            >
              {datasets.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {interpolate(record.results.dataset, { id: option.id })}
                  {option.isActive ? ' · ' + record.recompute.activeDefault : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'full' && (
          <Input
            label={interpolate(record.rerunTyped.instruction, { id: submissionId })}
            inputMode="numeric"
            value={typed}
            placeholder={String(submissionId)}
            disabled={running}
            error={typed.trim() === '' || matchesTyped ? undefined : record.rerunTyped.mismatch}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
        <div className="space-y-1.5">
          <label htmlFor="submission-recompute-reason" className="text-sm font-medium text-foreground ml-1">
            {dictionary.groups.reasonPlaceholder}
          </label>
          <input
            id="submission-recompute-reason"
            type="text"
            value={reason}
            disabled={running}
            className={REASON_CLASSES}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={close} disabled={running}>
          {confirmations.cancel}
        </Button>
        <Button
          variant={kind === 'full' ? 'negative' : 'positive'}
          size="sm"
          disabled={!canRun}
          loading={running}
          onClick={run}
        >
          {kind === 'full' ? record.rerunTyped.confirm : confirmations.recalculate.confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );

  return { dialog, ask };
}
