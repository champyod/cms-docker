'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { moveEvaluationLane } from '@/app/actions/evaluationLanes';
import { Button } from '@/components/core/Button';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { cn } from '@/lib/utils';

interface MoveLaneSelectorProps {
  submissionId: number;
  lanes: string[];
  onMoved?: () => void;
  allowCreate?: boolean;
  canMove: boolean;
}

const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20';
const MAX_REASON_LENGTH = 500;
const MAX_LANE_LENGTH = 64;

export function MoveLaneSelector({ submissionId, lanes, onMoved, allowCreate = false, canMove }: MoveLaneSelectorProps): React.ReactNode {
  const router = useRouter();
  const runAction = useActionFeedback();
  const [lane, setLane] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);

  if (!canMove) {
    return null;
  }

  const handleMove = async (): Promise<void> => {
    setReasonError(null);
    setIsMoving(true);
    try {
      const outcome = await runAction(
        { pending: 'Moving evaluation lane…', success: 'Lane moved', failure: 'Lane move failed' },
        () => moveEvaluationLane(submissionId, lane.trim(), reason.trim()),
      );
      if (outcome?.field === 'reason') {
        setReasonError(outcome.error ?? 'Invalid reason');
        reasonInputRef.current?.focus();
      } else if (outcome?.success) {
        setReason('');
        router.refresh();
        onMoved?.();
      }
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Move lane</h3>
      <div className="space-y-1.5">
        <label htmlFor="move-lane-name" className="text-sm font-medium text-foreground ml-1">Lane</label>
        {allowCreate ? (
          <>
            <input
              id="move-lane-name"
              type="text"
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              maxLength={MAX_LANE_LENGTH}
              placeholder="e.g. final"
              list="move-lane-options"
              disabled={isMoving}
              className={FIELD_CLASSES}
            />
            <datalist id="move-lane-options">
              {lanes.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </>
        ) : (
          <select
            id="move-lane-name"
            value={lane}
            onChange={(e) => setLane(e.target.value)}
            disabled={isMoving}
            className={FIELD_CLASSES}
          >
            <option value="">Select a lane</option>
            {lanes.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="move-lane-reason" className="text-sm font-medium text-foreground ml-1">
          Reason <span aria-hidden="true">*</span>
        </label>
        <textarea
          ref={reasonInputRef}
          id="move-lane-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(null);
          }}
          rows={3}
          maxLength={MAX_REASON_LENGTH}
          placeholder="Why is this submission moved to this lane?"
          disabled={isMoving}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? 'move-lane-reason-error move-lane-reason-hint' : 'move-lane-reason-hint'}
          title={reasonError ?? undefined}
          className={cn(FIELD_CLASSES, 'min-h-20')}
        />
        <div className="flex items-start justify-between gap-2">
          <div>
            {reasonError && (
              <p id="move-lane-reason-error" role="alert" className="text-xs text-destructive ml-1">{reasonError}</p>
            )}
            <p id="move-lane-reason-hint" className="text-xs text-muted-foreground ml-1">Required — recorded with the lane move.</p>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0" aria-hidden="true">{reason.length}/{MAX_REASON_LENGTH}</span>
        </div>
      </div>
      <Button
        variant="positive"
        size="sm"
        loading={isMoving}
        disabled={isMoving}
        onClick={() => { void handleMove(); }}
      >
        Move
      </Button>
    </div>
  );
}
