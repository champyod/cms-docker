'use client';

import { AlertCircle, CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { recalculateSubmission, getSubmissionFieldAccess } from '@/app/actions/submissions';
import { downloadSubmissionFiles } from '@/app/actions/related-reads';
import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { RestrictedField } from '@/components/core/RestrictedField';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import type { FieldAccess } from '@/lib/field-permissions';
import { cn } from '@/lib/utils';

import { SubmissionListItem } from '@/types';

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: SubmissionListItem;
  canRecompute: boolean;
  canDownload: boolean;
}

export function SubmissionModal({ isOpen, onClose, submission, canRecompute, canDownload }: SubmissionModalProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const { recalculateSubmissionConfirm } = useConfirmationCopy();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [fieldAccess, setFieldAccess] = useState<Record<string, FieldAccess> | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const access = await getSubmissionFieldAccess();
        if (!cancelled) setFieldAccess(access);
      } catch {
        // Why: field access is a UI hint, not a security gate — server enforces permissions
        if (!cancelled) setFieldAccess(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const result = submission.submission_results[0];
    const compilationFailed = result?.compilation_outcome === 'fail';

  const handleRecalculate = async (type: 'score' | 'evaluation' | 'full') => {
      if (!(await confirm(recalculateSubmissionConfirm(type)))) return;

      setLoadingAction(type);
      try {
          await recalculateSubmission(submission.id, type);
          // The list re-derives this row from the refreshed props, so the modal stays open
          // and shows the recalculated results instead of the ones it was opened with.
          router.refresh();
      } catch (error) {
          toast.error('Error: ' + error);
      } finally {
          setLoadingAction(null);
      }
  };

  const handleDownloadFiles = async () => {
      setLoadingAction('download');
      try {
          const list = await downloadSubmissionFiles(submission.id);
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
              if (!content) continue;
              const anchor = document.createElement('a');
              anchor.href = `data:application/octet-stream;base64,${content.data}`;
              anchor.download = file.filename;
              anchor.click();
          }
      } catch (error) {
          toast.error('Error: ' + error);
      } finally {
          setLoadingAction(null);
      }
  };

    return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Submission #${submission.id}`}
      className="sm:max-w-4xl"
    >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
            <div className="text-muted-foreground text-sm flex flex-wrap gap-4">
                <span>User: <span className="font-medium text-foreground">{submission.participations.users.username}</span></span>
                <span>Task: <span className="font-medium text-foreground">{submission.tasks.name}</span></span>
                <span>Time: {new Date(submission.timestamp).toLocaleString()}</span>
            </div>
            {result?.score !== null && (
              <span
                className={cn(
                  'text-sm px-2 py-0.5 rounded-full border shrink-0',
                  (result?.score || 0) > 0
                    ? 'text-success border-success/30 bg-success/10'
                    : 'text-destructive border-destructive/30 bg-destructive/10'
                )}
              >
                {result?.score?.toFixed(1) || 0} pts
              </span>
            )}
        </div>
        <div className="max-h-96 overflow-y-auto pr-1 space-y-6">
            <RestrictedField
              canRead={fieldAccess?.id?.canRead ?? true}
              canUpdate={false}
              label="Results"
              lockHint="Read-only — evaluation results"
            >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/40 rounded-xl p-4 border border-border">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Compilation</h3>
                    <div className="flex items-center gap-2">
                      {result?.compilation_outcome === 'ok' ? (
                        <CheckCircle2 className="text-success w-5 h-5" />
                      ) : result?.compilation_outcome === 'fail' ? (
                        <XCircle className="text-destructive w-5 h-5" />
                      ) : (
                        <Loader2 className="text-info w-5 h-5 animate-spin" />
                      )}
                      <span className="font-medium capitalize">{result?.compilation_outcome || 'Pending...'}</span>
                    </div>
                     {result?.compilation_time !== null && (
                        <div className="mt-2 text-xs text-muted-foreground font-mono">
                            Time: {result.compilation_time?.toFixed(3)}s <br/>
                            Memory: {(Number(result.compilation_memory) / 1024 / 1024).toFixed(2)} MB
                        </div>
                    )}
                </div>

                 <div className="bg-muted/40 rounded-xl p-4 border border-border">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Evaluation</h3>
                    <div className="flex items-center gap-2">
                      {compilationFailed ? (
                        <AlertCircle className="text-muted-foreground w-5 h-5" />
                      ) : result?.evaluation_outcome === 'ok' ? (
                        <CheckCircle2 className="text-success w-5 h-5" />
                      ) : (
                        <AlertCircle className="text-muted-foreground w-5 h-5" />
                      )}
                      <span className="font-medium capitalize">
                        {compilationFailed ? 'Skipped (Compilation Failed)' : result?.evaluation_outcome || 'Pending/Skipped'}
                      </span>
                    </div>
                </div>

                 <div className="bg-muted/40 rounded-xl p-4 border border-border">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Detailed Status</h3>
                     <span className="font-medium capitalize flex items-center gap-2">
                        {result?.compilation_outcome === null ? 'Compiling' :
                                 result?.compilation_outcome === 'fail' ? 'Compilation Failed' :
                                 result?.evaluation_outcome === null ? 'Evaluating' :
                         result?.score === null ? 'Scoring' : 'Done'}
                     </span>
                </div>
            </div>
            {result?.compilation_text && result.compilation_text.length > 0 && (
                <div className="space-y-2">
                     <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-muted-foreground" />
                        Compilation Logs
                    </h3>
                    <div className="bg-background rounded-lg p-4 font-mono text-xs overflow-x-auto whitespace-pre-wrap border border-border">
                        {result.compilation_text.join('\n')}
                        {result.compilation_stdout && `\nStdout:\n${result.compilation_stdout}`}
                        {result.compilation_stderr && `\nStderr:\n${result.compilation_stderr}`}
                    </div>
                </div>
            )}

            </RestrictedField>
        </div>
        <DialogFooter className="mt-6 pt-4 border-t border-border">
             {canRecompute && (
              <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                 <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { void handleRecalculate('score'); }}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'score' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Rescore
                 </Button>
                 <div className="w-px h-4 bg-border"></div>
                 <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { void handleRecalculate('evaluation'); }}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'evaluation' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Re-evaluate
                 </Button>
                 <div className="w-px h-4 bg-border"></div>
                 <Button
                    variant="negativeOutline"
                    size="sm"
                    onClick={() => { void handleRecalculate('full'); }}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'full' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Full Re-run
                 </Button>
              </div>
             )}

             {canDownload && (
                 <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { void handleDownloadFiles(); }}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'download' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Download files
                 </Button>
              )}
              <Button variant="positive" onClick={onClose}>
                 Close
             </Button>
        </DialogFooter>
    </Dialog>
  );
}
