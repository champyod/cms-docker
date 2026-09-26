'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { recalculateSubmission, toggleSubmissionOfficial } from '@/app/actions/submissions';
import { downloadSubmissionFiles } from '@/app/actions/related-reads';
import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';

import { MoveLaneDialog } from './MoveLaneDialog';
import { SubmissionCommentDialog } from './SubmissionCommentDialog';

export type SubmissionActionEntry = 'recompute' | 'download' | 'comment' | 'official' | 'lane';

type RecomputeKind = 'score' | 'evaluation' | 'full';

const RECOMPUTE_CHOICES: readonly { kind: RecomputeKind; label: string }[] = [
  { kind: 'score', label: 'Rescore' },
  { kind: 'evaluation', label: 'Re-evaluate' },
  { kind: 'full', label: 'Full Re-run' },
];

export interface SubmissionActionBarProps {
  readonly submissionId: number;
  readonly capabilities: SubmissionSummary['capabilities'];
  /** Required only when the bar renders the 'comment' or 'official' entries. */
  readonly comment?: string;
  readonly official?: boolean;
  readonly entries: readonly SubmissionActionEntry[];
  readonly navigation: Dictionary['navigation'];
}

function saveDownloadedFile(filename: string, data: string): void {
  const anchor = document.createElement('a');
  anchor.href = `data:application/octet-stream;base64,${data}`;
  anchor.download = filename;
  anchor.click();
}

function useSubmissionDownload(submissionId: number, refresh: () => void): {
  readonly downloading: boolean;
  readonly download: () => Promise<void>;
} {
  const [downloading, setDownloading] = useState(false);
  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const list = await downloadSubmissionFiles(submissionId);
      if (!list.success || !list.files) {
        toast.error('Error: ' + (list.error ?? 'download failed'));
        return;
      }
      if (list.files.length === 0) {
        toast.error('No stored files for this submission');
        return;
      }
      for (const file of list.files) {
        const content = await getFileByDigest(file.digest);
        if (content) saveDownloadedFile(file.filename, content.data);
      }
      refresh();
    } catch (error: unknown) {
      toast.error('Error: ' + String(error));
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, download };
}

function useOfficialToggle(submissionId: number, refresh: () => void): () => Promise<void> {
  const confirm = useConfirm();
  const { toggleOfficialConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();
  return async (): Promise<void> => {
    if (!(await confirm(toggleOfficialConfirm()))) return;
    const outcome = await runAction(
      { pending: 'Saving official flag...', success: 'Official flag saved', failure: 'Official flag update failed' },
      () => toggleSubmissionOfficial(submissionId),
    );
    if (outcome?.success) refresh();
  };
}

function RecomputeControls({ submissionId, refresh }: {
  readonly submissionId: number;
  readonly refresh: () => void;
}): React.JSX.Element {
  const confirm = useConfirm();
  const { recalculateSubmissionConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();
  const [pending, setPending] = useState<RecomputeKind | null>(null);

  const recompute = async (kind: RecomputeKind): Promise<void> => {
    if (!(await confirm(recalculateSubmissionConfirm(kind)))) return;
    setPending(kind);
    try {
      const outcome = await runAction(
        { pending: 'Recalculating...', success: 'Submission queued for recalculation', failure: 'Recalculation failed' },
        () => recalculateSubmission(submissionId, kind),
      );
      if (outcome?.success) refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
      {RECOMPUTE_CHOICES.map(({ kind, label }, index) => (
        <span key={kind} className="flex items-center gap-1">
          {index > 0 && <span className="w-px h-4 bg-border" aria-hidden="true" />}
          <Button
            variant={kind === 'full' ? 'negativeOutline' : 'secondary'}
            size="sm"
            onClick={() => { void recompute(kind); }}
            disabled={pending !== null}
          >
            {pending === kind && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {label}
          </Button>
        </span>
      ))}
    </div>
  );
}

export function SubmissionActionBar({
  submissionId,
  capabilities,
  comment,
  official,
  entries,
  navigation,
}: SubmissionActionBarProps): React.JSX.Element {
  const router = useAppRouter();
  const { downloading, download } = useSubmissionDownload(submissionId, router.refresh);
  const toggleOfficial = useOfficialToggle(submissionId, router.refresh);
  const shows = (entry: SubmissionActionEntry): boolean => entries.includes(entry);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t border-border">
      {shows('recompute') && capabilities.canRecompute && (
        <RecomputeControls submissionId={submissionId} refresh={router.refresh} />
      )}
      {shows('download') && capabilities.canDownload && (
        <Button variant="secondary" size="sm" onClick={() => { void download(); }} disabled={downloading}>
          {downloading && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
          Download files
        </Button>
      )}
      {shows('comment') && capabilities.canUpdate && (
        <SubmissionCommentDialog submissionId={submissionId} comment={comment ?? ''} navigation={navigation} />
      )}
      {shows('official') && capabilities.canUpdate && (
        <Button variant="secondary" size="sm" onClick={() => { void toggleOfficial(); }}>
          {official ? 'Clear official' : 'Mark official'}
        </Button>
      )}
      {shows('lane') && capabilities.canMoveLane && (
        <MoveLaneDialog submissionId={submissionId} canMove={capabilities.canMoveLane} navigation={navigation} />
      )}
    </div>
  );
}
