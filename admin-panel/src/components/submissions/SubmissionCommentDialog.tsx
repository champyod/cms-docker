'use client';

import { useState } from 'react';

import { updateSubmissionComment } from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import type { Dictionary } from '@/lib/dictionary';

const MAX_COMMENT_LENGTH = 2000;
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export interface SubmissionCommentDialogProps {
  readonly submissionId: number;
  readonly comment: string;
  readonly navigation: Dictionary['navigation'];
}

export function SubmissionCommentDialog({ submissionId, comment, navigation }: SubmissionCommentDialogProps): React.JSX.Element {
  const router = useAppRouter();
  const runAction = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(comment);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const outcome = await runAction(
        { pending: 'Saving comment...', success: 'Comment saved', failure: 'Comment update failed' },
        () => updateSubmissionComment(submissionId, value),
      );
      if (outcome?.success) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit comment
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Edit comment — ${navigation.evaluation['submission-record'].label} #${submissionId}`}
        description="The comment is stored on the submission and is visible to every reader who may open it."
      >
        <label htmlFor="submission-comment" className="text-sm font-medium text-foreground ml-1">Comment</label>
        <textarea
          id="submission-comment"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          disabled={saving}
          className={FIELD_CLASSES}
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="positive" size="sm" loading={saving} disabled={saving} onClick={() => { void save(); }}>
            Save comment
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
