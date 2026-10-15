'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { toggleSubmissionOfficial } from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { interpolate } from '@/lib/interpolate';
import { withBasePath } from '@/lib/base-path';
import { cn } from '@/lib/utils';

import { MoveLaneDialog } from './MoveLaneDialog';
import { SubmissionCommentDialog } from './SubmissionCommentDialog';
import { SubmissionRerunMenu } from './SubmissionRerunMenu';
import { useRecomputeDialog, type RecomputeKind } from './SubmissionRecomputeDialog';

export type SubmissionActionEntry = 'recompute' | 'download' | 'comment' | 'official' | 'lane';

type RecomputeLabelKey = 'rescore' | 'reEvaluate';

const RECOMPUTE_CHOICES: readonly { kind: RecomputeKind; labelKey: RecomputeLabelKey }[] = [
  { kind: 'score', labelKey: 'rescore' },
  { kind: 'evaluation', labelKey: 'reEvaluate' },
];

interface SubmissionActionBarSharedProps {
  readonly submissionId: number;
  readonly capabilities: SubmissionSummary['capabilities'];
  /** The submission's task, or null when this reader may not read it; gates the dataset picker. */
  readonly taskId: number | null;
  /** Keys of a partially granted capability group, shown as a lock hint instead of silence. */
  readonly lockHintKeys?: readonly string[];
}

// Why the coupling: an entry without its data prop used to fall back to comment ?? '' and wipe the stored comment.
type WithCommentProp<E extends readonly SubmissionActionEntry[]> =
  'comment' extends E[number] ? { readonly comment: string } : { readonly comment?: never };

type WithOfficialProp<E extends readonly SubmissionActionEntry[]> =
  'official' extends E[number] ? { readonly official: boolean } : { readonly official?: never };

export type SubmissionActionBarProps<E extends readonly SubmissionActionEntry[] = readonly SubmissionActionEntry[]> =
  SubmissionActionBarSharedProps & { readonly entries: E } & WithCommentProp<E> & WithOfficialProp<E>;

function PendingSlot({ pending }: { readonly pending: boolean }): React.JSX.Element {
  return (
    <span className="inline-flex w-3 shrink-0 justify-center" aria-hidden="true">
      {pending && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
    </span>
  );
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const message = Reflect.get(payload, 'error');
    if (typeof message === 'string' && message !== '') return message;
  }
  return fallback;
}

function useSubmissionDownload(submissionId: number, refresh: () => void): {
  readonly downloading: boolean;
  readonly download: () => Promise<void>;
} {
  const toasts = useDictionary().submissions.record.toasts;
  const [downloading, setDownloading] = useState(false);
  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const response = await fetch(withBasePath('/api/submissions/' + submissionId + '/files/zip'));
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => ({}));
        toast.error(readErrorMessage(payload, toasts.downloadEmpty));
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'submission-' + submissionId + '.zip';
      anchor.click();
      URL.revokeObjectURL(url);
      refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, download };
}

function DownloadControl({ submissionId }: { readonly submissionId: number }): React.JSX.Element {
  const label = useDictionary().submissions.record.actions.downloadFiles;
  const router = useAppRouter();
  const { downloading, download } = useSubmissionDownload(submissionId, router.refresh);
  return (
    <Button variant="secondary" size="sm" disabled={downloading} onClick={() => void download()}>
      <PendingSlot pending={downloading} />
      {label}
    </Button>
  );
}

function OfficialSwitch({ submissionId, official }: {
  readonly submissionId: number;
  readonly official: boolean;
}): React.JSX.Element {
  const record = useDictionary().submissions.record;
  const router = useAppRouter();
  const [saving, setSaving] = useState(false);

  const flip = async (offerRevert: boolean): Promise<void> => {
    const pendingId = toast.loading(record.toasts.officialPending);
    setSaving(true);
    try {
      const outcome = await toggleSubmissionOfficial(submissionId);
      if (outcome.success) {
        toast.success(record.toasts.officialSaved, {
          id: pendingId,
          ...(offerRevert
            ? { action: { label: record.official.revert, onClick: () => { void flip(false); } } }
            : {}),
        });
      } else {
        toast.error(outcome.error ?? record.toasts.officialFailed, { id: pendingId });
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : record.toasts.officialFailed, { id: pendingId });
    } finally {
      setSaving(false);
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={official}
      disabled={saving}
      onClick={() => { void flip(true); }}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        official
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      <span aria-hidden="true" className={cn('relative h-4 w-7 rounded-full transition-colors', official ? 'bg-success' : 'bg-muted-foreground/40')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all', official ? 'left-3.5' : 'left-0.5')} />
      </span>
      {official ? record.official.on : record.official.off}
    </button>
  );
}

export function SubmissionActionBar<const E extends readonly SubmissionActionEntry[]>({
  submissionId,
  capabilities,
  entries,
  taskId,
  lockHintKeys,
  comment,
  official,
}: SubmissionActionBarProps<E>): React.JSX.Element {
  const dictionary = useDictionary();
  const record = dictionary.submissions.record;
  const toolbarLabel = interpolate(record.toolbarLabel, { id: submissionId });
  const recompute = useRecomputeDialog({ submissionId, taskId });
  const shows = (entry: SubmissionActionEntry): boolean => entries.includes(entry);
  const canRecompute = shows('recompute') && capabilities.canRecompute;
  const hint = lockHintKeys !== undefined && lockHintKeys.length > 0
    ? interpolate(dictionary.submissions.lockHint, { keys: lockHintKeys.join(', ') })
    : null;
  return (
    <>
      <div
        role="toolbar"
        aria-label={toolbarLabel}
        className="flex flex-wrap items-center justify-end gap-2"
      >
        {canRecompute && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {RECOMPUTE_CHOICES.map(({ kind, labelKey }, index) => (
              <span key={kind} className="flex items-center gap-1">
                {index > 0 && <span className="w-px h-4 bg-border" aria-hidden="true" />}
                <Button variant="secondary" size="sm" onClick={() => recompute.ask(kind)}>
                  {record.actions[labelKey]}
                </Button>
              </span>
            ))}
          </div>
        )}
        {canRecompute && <SubmissionRerunMenu onFullRerun={() => recompute.ask('full')} />}
        {shows('download') && capabilities.canDownload && <DownloadControl submissionId={submissionId} />}
        {shows('comment') && capabilities.canUpdate && (
          <SubmissionCommentDialog submissionId={submissionId} comment={comment ?? ''} />
        )}
        {shows('official') && capabilities.canUpdate && (
          <OfficialSwitch submissionId={submissionId} official={official ?? false} />
        )}
        {shows('lane') && capabilities.canMoveLane && (
          <MoveLaneDialog submissionId={submissionId} canMove={capabilities.canMoveLane} />
        )}
      </div>
      {hint !== null && (
        <p className="text-right text-xs text-muted-foreground">{hint}</p>
      )}
      {recompute.dialog}
    </>
  );
}
