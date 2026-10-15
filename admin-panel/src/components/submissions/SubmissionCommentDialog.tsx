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

const MAX_COMMENT_LENGTH = 2000;
const FIELD_CLASSES = 'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export interface SubmissionCommentDialogProps {
  readonly submissionId: number;
  readonly comment: string;
  /** The newest recorded edit, once the record page has history to show. */
  readonly lastEdited?: { readonly name: string; readonly timestamp: string };
}

function CommentEditor({ value, saving, label, onChange }: {
  readonly value: string;
  readonly saving: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <>
      <label htmlFor="submission-comment" className="text-sm font-medium text-foreground ml-1">{label}</label>
      <textarea
        id="submission-comment"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        maxLength={MAX_COMMENT_LENGTH}
        disabled={saving}
        className={FIELD_CLASSES}
      />
      <p aria-hidden="true" className="text-right text-xs text-muted-foreground">
        {value.length + ' / ' + MAX_COMMENT_LENGTH}
      </p>
    </>
  );
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
        <CommentEditor value={value} saving={saving} label={copy.label} onChange={setValue} />
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
