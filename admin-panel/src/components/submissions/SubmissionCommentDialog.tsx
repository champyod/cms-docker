'use client';

import { useState } from 'react';

import { updateSubmissionComment } from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import { useUnsavedChangesGuard, type DismissReason } from '@/hooks/useUnsavedChangesGuard';
import { interpolate } from '@/lib/interpolate';

import { CommentEditor } from './CommentEditor';

export interface SubmissionCommentDialogProps {
  readonly submissionId: number;
  readonly comment: string;
  /** The newest recorded edit, once the record page has history to show. */
  readonly lastEdited?: { readonly name: string; readonly timestamp: string };
}

function LastEditedLine({ lastEdited }: {
  readonly lastEdited: NonNullable<SubmissionCommentDialogProps['lastEdited']>;
}): React.JSX.Element {
  const formatTimestamp = useFormatTimestamp();
  const template = useDictionary().submissions.record.comment.lastEdited;
  return (
    <p className="text-xs text-muted-foreground">
      {interpolate(template, { name: lastEdited.name, time: formatTimestamp(lastEdited.timestamp) })}
    </p>
  );
}

function useCommentSave(submissionId: number, value: string, onSaved: () => void): {
  readonly saving: boolean;
  readonly save: () => Promise<void>;
} {
  const toasts = useDictionary().submissions.record.comment.toasts;
  const router = useAppRouter();
  const runAction = useActionFeedback();
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const outcome = await runAction(
        { pending: toasts.pending, success: toasts.saved, failure: toasts.failed },
        () => updateSubmissionComment(submissionId, value),
      );
      if (outcome?.success) {
        onSaved();
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };
  return { saving, save };
}

export function SubmissionCommentDialog({ submissionId, comment, lastEdited }: SubmissionCommentDialogProps): React.JSX.Element {
  const dictionary = useDictionary();
  const copy = dictionary.submissions.record.comment;
  const recordLabel = dictionary.navigation.evaluation['submission-record'].label;
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(comment);
  const guard = useUnsavedChangesGuard(value !== comment, confirm, () => setOpen(false));
  const { saving, save } = useCommentSave(submissionId, value, () => {
    guard.markClean();
    setOpen(false);
  });

  const handleOpenChange = (next: boolean, reason: DismissReason): void => {
    if (next) {
      setOpen(true);
      return;
    }
    guard.requestClose(reason);
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {dictionary.submissions.record.actions.editComment}
      </Button>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={interpolate(copy.title, { record: recordLabel, id: submissionId })}
        description={copy.description}
        pending={saving}
      >
        <CommentEditor value={value} disabled={saving} onChange={setValue} />
        {lastEdited && <LastEditedLine lastEdited={lastEdited} />}
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => guard.requestClose('close')} disabled={saving}>
            {dictionary.confirmations.cancel}
          </Button>
          <Button variant="positive" size="sm" loading={saving} disabled={saving} onClick={() => void save()}>
            {copy.save}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
