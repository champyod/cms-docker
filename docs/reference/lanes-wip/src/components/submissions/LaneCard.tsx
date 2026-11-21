'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';

import { moveEvaluationLane } from '@/app/actions/evaluationLanes';
import type { LaneBoardItem } from '@/app/actions/evaluationLaneBoard';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import type { Dictionary } from '@/lib/dictionary';
import { cn } from '@/lib/utils';

import { MoveLaneSelector } from './MoveLaneSelector';

export interface PendingDrop {
  submissionId: number;
  laneId: number | null;
  laneName: string;
}

const FIELD_CLASSES =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring';

export function LaneCard({
  item,
  laneOptions,
  labels,
  locale,
  canMove,
  expanded,
  pending,
  onToggle,
  onDone,
  onCancelDrop,
}: {
  item: LaneBoardItem;
  laneOptions: readonly { id: number; name: string }[];
  labels: Dictionary['submissions'];
  locale: string;
  canMove: boolean;
  expanded: boolean;
  pending: PendingDrop | null;
  onToggle: () => void;
  onDone: () => void;
  onCancelDrop: () => void;
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.submissionId,
    data: { laneId: item.laneId },
    disabled: !canMove,
  });
  // Why the route locale, not the default: the board is rendered per locale, and an
  // unqualified Intl.DateTimeFormat would follow the server/browser locale instead.
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale), [locale]);

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn('rounded-lg border border-border bg-background p-3 space-y-1.5', isDragging && 'opacity-50 ring-2 ring-primary/40')}
    >
      <div {...attributes} {...listeners} className={canMove ? 'cursor-grab active:cursor-grabbing' : undefined}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">#{item.submissionId}</span>
          <Badge variant={item.waitingCount > 0 ? 'warning' : 'neutral'}>
            {labels.laneWaiting} {item.waitingCount}
          </Badge>
        </div>
        <p className="text-sm font-medium">{item.username}</p>
        <p className="text-xs text-muted-foreground">{item.taskName} · {timeFormat.format(new Date(item.timestamp))}</p>
      </div>
      {canMove && (
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {expanded ? labels.laneMoveClose : labels.laneMoveOpen}
        </Button>
      )}
      {pending !== null && <DropConfirm pending={pending} labels={labels} onDone={onDone} onCancel={onCancelDrop} />}
      {expanded && pending === null && canMove && (
        <MoveLaneSelector
          submissionId={item.submissionId}
          lanes={laneOptions.filter((lane) => lane.id !== item.laneId)}
          currentLaneId={item.laneId}
          labels={labels}
          canMove={canMove}
          onMoved={onDone}
        />
      )}
    </article>
  );
}

function DropConfirm({
  pending,
  labels,
  onDone,
  onCancel,
}: {
  pending: PendingDrop;
  labels: Dictionary['submissions'];
  onDone: () => void;
  onCancel: () => void;
}): React.ReactNode {
  const runAction = useActionFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await runAction(
        { pending: 'Moving evaluation lane…', success: 'Lane moved', failure: 'Lane move failed' },
        () => moveEvaluationLane(pending.submissionId, pending.laneId, reason.trim()),
      );
      // Why surface the field error too: a drop is one of two entries to this flow, and the
      // selector already reports a rejected reason — silently doing nothing here would read
      // as a broken drag rather than a validation failure.
      if (outcome?.success) {
        onDone();
      } else if (outcome?.error !== undefined) {
        setError(outcome.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
      <p className="text-xs font-medium">
        #{pending.submissionId} → {pending.laneName}
      </p>
      <textarea
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
          onClick={() => { void handleMove(); }}
        >
          {labels.laneMoveSubmit}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {labels.laneCancel}
        </Button>
      </div>
    </div>
  );
}
