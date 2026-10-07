'use client';

import { useState } from 'react';

import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import type { Dictionary } from '@/lib/dictionary';

import { MoveLaneSelector } from './MoveLaneSelector';

export interface MoveLaneDialogProps {
  readonly submissionId: number;
  readonly canMove: boolean;
  readonly navigation: Dictionary['navigation'];
}

export function MoveLaneDialog({ submissionId, canMove, navigation }: MoveLaneDialogProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!canMove) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Move lane
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Move lane — ${navigation.evaluation['submission-record'].label} #${submissionId}`}
        description="A lane move is recorded with its reason and can be moved again later."
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
