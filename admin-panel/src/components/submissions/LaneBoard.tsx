'use client';

import { DndContext, PointerSensor, useDroppable, useSensor, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { moveEvaluationLane, type LaneBoard as LaneBoardData, type LaneBoardItem } from '@/app/actions/evaluationLanes';
import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { EmptyState } from '@/components/core/EmptyState';
import { MoveLaneSelector } from './MoveLaneSelector';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { cn } from '@/lib/utils';

interface LaneBoardProps {
  board: LaneBoardData;
  permissionKeys: readonly string[];
}

interface PendingDrop {
  submissionId: number;
  lane: string;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring';

// Why module scope: every card formats its own timestamp, so a per-card formatter
// would be rebuilt for each row on every render.
const LANE_TIME_FORMAT = new Intl.DateTimeFormat();

export function LaneBoard({ board, permissionKeys }: LaneBoardProps) {
  const router = useRouter();
  const sensor = useSensor(PointerSensor, { activationConstraint: { distance: 4 } });
  // Why memoized: the key list is stable for the session, so the gate below rebuilds
  // the same Set on every render without reading different data.
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  // Why lane_move, not lane_assign: every card already has a lane, so any
  // placement change is a move — matching how SubmissionList gates its modal.
  const canMove = hasEffectivePermission(effective, 'evaluation:lane_move');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const laneNames = useMemo(() => board.lanes.map((entry) => entry.lane), [board]);
  // Why no windowing: the server caps this board before it reaches here, and the
  // sibling lists are paginated rather than virtualized. Row virtualisation would
  // also unmount the drag handles dnd-kit measures against, so a drop that looks
  // available would no longer be droppable.
  const allItems = useMemo(() => board.lanes.flatMap((entry) => entry.items), [board]);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || !canMove) return;
    const sourceLane = active.data.current?.lane as string | undefined;
    const rawOver = over.data.current?.lane as string | undefined;
    const targetLane = rawOver ?? (typeof over.id === 'string' && over.id.startsWith('lane:') ? over.id.slice(5) : undefined);
    if (sourceLane === undefined || targetLane === undefined || sourceLane === targetLane) return;
    // Why confirm, not direct move: a lane change needs an audit reason, so the
    // drop stages the target and the same move action runs after reason entry.
    setPending({ submissionId: Number(active.id), lane: targetLane });
    setExpandedId(Number(active.id));
  };

  const refresh = (): void => {
    setPending(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={board.waitingSource === 'rpc' ? 'success' : 'neutral'}>
          {board.waitingSource === 'rpc' ? 'Live queue' : 'Database fallback'}
        </Badge>
        {canMove && (
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            Create lane
          </Button>
        )}
      </div>

      {board.lanes.length === 0 ? (
        <EmptyState title="No lanes yet" description="Assign a submission to a lane to start the board." />
      ) : (
        <DndContext sensors={[sensor]} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {board.lanes.map((entry) => (
              <LaneColumn
                key={entry.lane}
                lane={entry.lane}
                items={entry.items}
                laneNames={laneNames}
                canMove={canMove}
                expandedId={expandedId}
                pending={pending}
                onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
                onDone={refresh}
                onCancelDrop={() => setPending(null)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {createOpen && (
        <CreateLaneDialog items={allItems} laneNames={laneNames} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); router.refresh(); }} />
      )}
    </div>
  );
}

function LaneColumn({ lane, items, laneNames, canMove, expandedId, pending, onToggle, onDone, onCancelDrop }: {
  lane: string; items: LaneBoardItem[]; laneNames: string[]; canMove: boolean;
  expandedId: number | null; pending: PendingDrop | null;
  onToggle: (id: number) => void; onDone: () => void; onCancelDrop: () => void;
}): React.ReactNode {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane}`, disabled: !canMove });
  return (
    <section ref={setNodeRef} aria-label={`Lane ${lane}`} className={cn('rounded-xl border border-border bg-muted/20 p-3 space-y-3', isOver && 'border-primary ring-2 ring-primary/30')}>
      <h2 className="text-sm font-semibold flex items-center justify-between">
        {lane}
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      <SortableContext items={items.map((item) => item.submissionId)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item) => (
            <LaneCard
              key={item.submissionId}
              item={item}
              laneNames={laneNames}
              canMove={canMove}
              expanded={expandedId === item.submissionId}
              pending={pending?.submissionId === item.submissionId ? pending : null}
              onToggle={() => onToggle(item.submissionId)}
              onDone={onDone}
              onCancelDrop={onCancelDrop}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function LaneCard({ item, laneNames, canMove, expanded, pending, onToggle, onDone, onCancelDrop }: {
  item: LaneBoardItem; laneNames: string[]; canMove: boolean;
  expanded: boolean; pending: PendingDrop | null;
  onToggle: () => void; onDone: () => void; onCancelDrop: () => void;
}): React.ReactNode {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.submissionId, data: { lane: item.lane }, disabled: !canMove });
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('rounded-lg border border-border bg-background p-3 space-y-1.5', isDragging && 'opacity-50 ring-2 ring-primary/40')}>
      <div {...attributes} {...listeners} className={canMove ? 'cursor-grab active:cursor-grabbing' : undefined}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">#{item.submissionId}</span>
          <Badge variant={item.waitingCount > 0 ? 'warning' : 'neutral'}>Waiting {item.waitingCount}</Badge>
        </div>
        <p className="text-sm font-medium">{item.username}</p>
        <p className="text-xs text-muted-foreground">{item.taskName} · {LANE_TIME_FORMAT.format(new Date(item.timestamp))}</p>
        {item.reason && <p className="text-xs text-muted-foreground italic truncate" title={item.reason}>Last: {item.reason}</p>}
      </div>
      {canMove && (
        <Button variant="ghost" size="sm" onClick={onToggle}>{expanded ? 'Hide move' : 'Move to'}</Button>
      )}
      {pending && <DropConfirm pending={pending} onDone={onDone} onCancel={onCancelDrop} />}
      {expanded && !pending && canMove && (
        <MoveLaneSelector submissionId={item.submissionId} lanes={laneNames.filter((name) => name !== item.lane)} canMove={canMove} onMoved={onDone} />
      )}
    </article>
  );
}

function DropConfirm({ pending, onDone, onCancel }: { pending: PendingDrop; onDone: () => void; onCancel: () => void }): React.ReactNode {
  const runAction = useActionFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const handleMove = async (): Promise<void> => {
    setBusy(true);
    try {
      // Why same action as the selector: drop and selector are two entries to one
      // move flow, so both call moveEvaluationLane with lane + reason.
      const outcome = await runAction(
        { pending: 'Moving evaluation lane…', success: 'Lane moved', failure: 'Lane move failed' },
        () => moveEvaluationLane(pending.submissionId, pending.lane, reason.trim()),
      );
      if (outcome?.success) onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
      <p className="text-xs font-medium">Move #{pending.submissionId} to {pending.lane}?</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Reason (required)" disabled={busy} className={FIELD_CLASSES} />
      <div className="flex gap-2">
        <Button variant="positive" size="sm" loading={busy} disabled={busy || reason.trim().length === 0} onClick={() => { void handleMove(); }}>Move</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function CreateLaneDialog({ items, laneNames, onClose, onDone }: { items: LaneBoardItem[]; laneNames: string[]; onClose: () => void; onDone: () => void }): React.ReactNode {
  const runAction = useActionFeedback();
  const [name, setName] = useState('');
  const [submissionId, setSubmissionId] = useState(items[0]?.submissionId.toString() ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const handleCreate = async (): Promise<void> => {
    setBusy(true);
    try {
      // Why a seed submission is required: lanes persist only as audit rows, so a
      // lane with no submission cannot be recorded — creation is a move to a new name.
      const outcome = await runAction(
        { pending: 'Creating lane…', success: 'Lane created', failure: 'Lane creation failed' },
        () => moveEvaluationLane(Number(submissionId), name.trim(), reason.trim()),
      );
      if (outcome?.success) onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }} title="Create lane" description="New lane names apply to a chosen submission via the move flow.">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="create-lane-name" className="text-sm font-medium ml-1">Lane name</label>
          <input id="create-lane-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. final" list="create-lane-existing" disabled={busy} className={FIELD_CLASSES} />
          <datalist id="create-lane-existing">{laneNames.map((lane) => <option key={lane} value={lane} />)}</datalist>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="create-lane-submission" className="text-sm font-medium ml-1">Submission</label>
          <select id="create-lane-submission" value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} disabled={busy} className={FIELD_CLASSES}>
            {items.map((item) => <option key={item.submissionId} value={item.submissionId}>#{item.submissionId} {item.username} — {item.taskName}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="create-lane-reason" className="text-sm font-medium ml-1">Reason *</label>
          <textarea id="create-lane-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Why is this lane created?" disabled={busy} className={FIELD_CLASSES} />
        </div>
        <div className="flex gap-2">
          <Button variant="positive" size="sm" loading={busy} disabled={busy || name.trim().length === 0 || reason.trim().length === 0 || submissionId === ''} onClick={() => { void handleCreate(); }}>Create</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
