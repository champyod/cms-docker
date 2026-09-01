'use client';

import { AlertCircle, CheckCircle2, Loader2, Terminal, XCircle } from 'lucide-react';
import { useState } from 'react';

import { recalculateSubmission } from '@/app/actions/submissions';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { cn } from '@/lib/utils';

import { SubmissionListItem } from '@/types';

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: SubmissionListItem;
}

export function SubmissionModal({ isOpen, onClose, submission }: SubmissionModalProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const result = submission.submission_results[0]; // Active result
    const compilationFailed = result?.compilation_outcome === 'fail';

  const handleRecalculate = async (type: 'score' | 'evaluation' | 'full') => {
      if (!confirm(`Are you sure you want to recalculate (${type})? This will clear current results.`)) return;

      setLoadingAction(type);
      try {
          await recalculateSubmission(submission.id, type);
          window.location.reload();
      } catch (error) {
          alert('Error: ' + error);
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
        {/* Header meta */}
        <div className="flex items-center justify-between gap-4 mb-6">
            <div className="text-muted-foreground text-sm flex gap-4">
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

        {/* Content - Scrollable */}
        <div className="max-h-96 overflow-y-auto pr-1 space-y-6">

            {/* Status Grid */}
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

            {/* Logs */}
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

        </div>

        {/* Footer Actions */}
        <DialogFooter className="mt-6 pt-4 border-t border-border">
             <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                 <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRecalculate('score')}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'score' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Rescore
                 </Button>
                 <div className="w-px h-4 bg-border"></div>
                 <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRecalculate('evaluation')}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'evaluation' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Re-evaluate
                 </Button>
                 <div className="w-px h-4 bg-border"></div>
                 <Button
                    variant="negativeOutline"
                    size="sm"
                    onClick={() => handleRecalculate('full')}
                    disabled={!!loadingAction}
                 >
                    {loadingAction === 'full' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Full Re-run
                 </Button>
             </div>

             <Button variant="positive" onClick={onClose}>
                 Close
             </Button>
        </DialogFooter>
    </Dialog>
  );
}
