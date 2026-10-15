'use client';

import { useState } from 'react';

import {
  applyCommentToSubmissionIds,
  applyCommentToSubmissions,
  previewCommentApplication,
  previewCommentApplicationByIds,
  type BatchCommentReport,
  type BatchRecalcPreview,
  type BatchRecalcScope,
} from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';

import { CommentEditor } from './CommentEditor';

export type CommentApplyTarget =
  | { readonly kind: 'ids'; readonly ids: readonly number[] }
  | { readonly kind: 'scope'; readonly scope: BatchRecalcScope };

export interface CommentApplyControlProps {
  readonly target: CommentApplyTarget;
  readonly canComment: boolean;
  readonly onSucceeded: () => void;
}

/** The blast-radius line the confirmation carries, with the match count appended. */
function blastRadius(preview: BatchRecalcPreview): string {
  if (preview.capped) {
    return `This matches ${preview.matched} submissions; only the first ${preview.willProcess} will be updated.`;
  }
  return `This updates ${preview.willProcess} submission(s).`;
}

function reportAlert(report: BatchCommentReport): React.JSX.Element {
  if (report.error !== undefined) return <InlineAlert tone="destructive">{report.error}</InlineAlert>;
  const summary = `Updated ${report.updated} of ${report.processed}.${report.failed > 0 ? ` ${report.failed} failed.` : ''}${report.capped ? ' More submissions matched than the batch limit.' : ''}`;
  return <InlineAlert tone={report.failed > 0 ? 'warning' : 'success'}>{summary}</InlineAlert>;
}

/**
 * Applies one comment to a resolved target: the checked ids or the list filter.
 *
 * WHY preview-then-confirm: the comment is written to every row in scope with
 * one click, so the dialog reads the match count before it runs and names the
 * cap, the same blast-radius discipline a bulk requeue uses.
 */
export function CommentApplyControl({ target, canComment, onSucceeded }: CommentApplyControlProps): React.JSX.Element | null {
  const dictionary = useDictionary();
  const copy = dictionary.submissions.record.comment;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<BatchRecalcPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BatchCommentReport | null>(null);

  if (!canComment) return null;

  const openDialog = (): void => {
    setOpen(true);
    setValue('');
    setError(null);
    setReport(null);
    setPreview(null);
    setPreviewing(true);
    const load = target.kind === 'ids'
      ? previewCommentApplicationByIds(target.ids)
      : previewCommentApplication(target.scope);
    void load
      .then((result) => setPreview(result))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : null))
      .finally(() => setPreviewing(false));
  };

  const apply = async (): Promise<void> => {
    if (value.trim() === '') {
      setError(copy.applyEmpty);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = target.kind === 'ids'
        ? await applyCommentToSubmissionIds(target.ids, value)
        : await applyCommentToSubmissions(target.scope, value);
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setReport(result);
      setOpen(false);
      onSucceeded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.applyFailed);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openDialog}>
        {dictionary.submissions.bulk.comment}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next): void => {
          if (!next) setOpen(false);
        }}
        title={copy.applyTitle}
        description={copy.applyDescription}
        pending={pending}
      >
        <div className="space-y-3">
          <CommentEditor value={value} disabled={pending} onChange={setValue} />
          {previewing ? <p role="status" className="text-xs text-muted-foreground">{copy.applyPreviewLoading}</p> : null}
          {preview !== null ? <p className="text-xs text-muted-foreground">{blastRadius(preview)}</p> : null}
          {error !== null ? <InlineAlert tone="destructive" density="compact">{error}</InlineAlert> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            {dictionary.confirmations.cancel}
          </Button>
          <Button variant="positive" size="sm" loading={pending} disabled={pending} onClick={() => void apply()}>
            {copy.applyConfirm}
          </Button>
        </DialogFooter>
      </Dialog>
      {report !== null ? <div className="w-full">{reportAlert(report)}</div> : null}
    </>
  );
}
