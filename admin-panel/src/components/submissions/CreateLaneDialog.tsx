'use client';

import { useState } from 'react';

import { moveEvaluationLane, type LaneBoardItem } from '@/app/actions/evaluationLanes';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import { useActionFeedback } from '@/hooks/useActionFeedback';

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring';

// Why one wrapper: the dialog stacks three labelled controls, and a per-field
// label block is the only thing that differs between them.
function DialogField({ id, label, children }: { id: string; label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium ml-1">{label}</label>
      {children}
    </div>
  );
}

export function CreateLaneDialog({ items, laneNames, onClose, onDone }: { items: LaneBoardItem[]; laneNames: string[]; onClose: () => void; onDone: () => void }): React.ReactNode {
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
        <DialogField id="create-lane-name" label="Lane name">
          <input id="create-lane-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. final" list="create-lane-existing" disabled={busy} className={FIELD_CLASSES} />
        </DialogField>
        <datalist id="create-lane-existing">{laneNames.map((lane) => <option key={lane} value={lane} />)}</datalist>
        <DialogField id="create-lane-submission" label="Submission">
          <select id="create-lane-submission" value={submissionId} onChange={(e) => setSubmissionId(e.target.value)} disabled={busy} className={FIELD_CLASSES}>
            {items.map((item) => <option key={item.submissionId} value={item.submissionId}>#{item.submissionId} {item.username} — {item.taskName}</option>)}
          </select>
        </DialogField>
        <DialogField id="create-lane-reason" label="Reason *">
          <textarea id="create-lane-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Why is this lane created?" disabled={busy} className={FIELD_CLASSES} />
        </DialogField>
        <div className="flex gap-2">
          <Button variant="positive" size="sm" loading={busy} disabled={busy || name.trim().length === 0 || reason.trim().length === 0 || submissionId === ''} onClick={() => { void handleCreate(); }}>Create</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
