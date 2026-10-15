'use client';

import { useState } from 'react';

import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { useDictionary } from '@/hooks/useDictionary';

import { MoveLaneSelector } from './MoveLaneSelector';

export interface MoveLaneDialogProps {
  readonly submissionId: number;
  readonly canMove: boolean;
}

export function MoveLaneDialog({ submissionId, canMove }: MoveLaneDialogProps): React.JSX.Element | null {
  const dictionary = useDictionary();
  const moveLaneLabel = dictionary.submissions.record.actions.moveLane;
  const [open, setOpen] = useState(false);
  if (!canMove) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {moveLaneLabel}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${moveLaneLabel} — ${dictionary.navigation.evaluation['submission-record'].label} #${submissionId}`}
        description={dictionary.submissions.record.lane.description}
      >
        {/* Why the shared selector: the lane board and this record entry point must
            enforce one reason rule and one double-submit guard, so the form is not
            reimplemented here. The selector validates the reason and refreshes the
            record on success; closing here returns focus to the invoking control. */}
        <MoveLaneSelector
          submissionId={submissionId}
          lanes={[]}
          allowCreate
          canMove={canMove}
          onMoved={() => setOpen(false)}
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
