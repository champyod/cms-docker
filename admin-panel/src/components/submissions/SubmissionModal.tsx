'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { X, Loader2, RefreshCw, Terminal, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { recalculateSubmission } from '@/app/actions/submissions';

import { SubmissionWithRelations } from '@/types';

interface SubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: SubmissionWithRelations;
}

export function SubmissionModal({ isOpen, onClose, submission }: SubmissionModalProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

  const result = submission.submission_results[0]; // Active result

    if (!isOpen || !mounted) return null;

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

    return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col relative animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex justify-between items-start bg-neutral-900/50">
            <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    Submission #{submission.id}
                    {result?.score !== null && (
                         <span className={`text-sm px-2 py-0.5 rounded-full border ${
                            (result?.score || 0) > 0 ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-red-400 border-red-500/30 bg-red-500/10'
                         }`}>
                             {result?.score?.toFixed(1) || 0} pts
                         </span>
                    )}
                </h2>
                <div className="text-neutral-400 text-sm mt-1 flex gap-4">
                    <span>User: <span className="text-white">{submission.participations.users.username}</span></span>
                    <span>Task: <span className="text-white">{submission.tasks.name}</span></span>
                    <span>Time: {new Date(submission.timestamp).toLocaleString()}</span>
                </div>
            </div>
            <button
                onClick={onClose}
                className="text-neutral-400 hover:text-white transition-colors p-1"
            >
                <X className="w-6 h-6" />
            </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Status Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Compilation</h3>
                    <div className="flex items-center gap-2">
                        {result?.compilation_outcome === 'ok' ? (
                            <CheckCircle2 className="text-green-400 w-5 h-5" />
                        ) : result?.compilation_outcome === 'fail' ? (
                            <XCircle className="text-red-400 w-5 h-5" />
                        ) : (
                            <Loader2 className="text-blue-400 w-5 h-5 animate-spin" />
                        )}
                        <span className="text-white font-medium capitalize">{result?.compilation_outcome || 'Pending...'}</span>
                    </div>
                     {result?.compilation_time !== null && (
                        <div className="mt-2 text-xs text-neutral-500 font-mono">
                            Time: {result.compilation_time?.toFixed(3)}s <br/>
                            Memory: {(Number(result.compilation_memory) / 1024 / 1024).toFixed(2)} MB
                        </div>
                    )}
                </div>

                 <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Evaluation</h3>
                    <div className="flex items-center gap-2">
                         {result?.evaluation_outcome === 'ok' ? (
                            <CheckCircle2 className="text-green-400 w-5 h-5" />
                        ) : (
                            <AlertCircle className="text-neutral-500 w-5 h-5" />
                        )}
                        <span className="text-white font-medium capitalize">{result?.evaluation_outcome || 'Pending/Skipped'}</span>
                    </div>
                </div>

                 <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                    <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Detailed Status</h3>
                     <span className="text-white font-medium capitalize flex items-center gap-2">
                        {result?.compilation_outcome === null ? 'Compiling' :
                         result?.evaluation_outcome === null ? 'Evaluating' :
                         result?.score === null ? 'Scoring' : 'Done'}
                     </span>
                </div>
            </div>

            {/* Logs */}
            {result?.compilation_text && result.compilation_text.length > 0 && (
                <div className="space-y-2">
                     <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-neutral-400" />
                        Compilation Logs
                    </h3>
                    <div className="bg-black/80 rounded-lg p-4 font-mono text-xs text-neutral-300 overflow-x-auto whitespace-pre-wrap border border-white/10">
                        {result.compilation_text.join('\n')}
                        {result.compilation_stdout && `\nStdout:\n${result.compilation_stdout}`}
                        {result.compilation_stderr && `\nStderr:\n${result.compilation_stderr}`}
                    </div>
                </div>
            )}
            
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-white/5 bg-neutral-900/50 flex justify-end gap-3">
             <div className="flex items-center gap-2 bg-neutral-800 rounded-lg p-1">
                 <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleRecalculate('score')}
                    disabled={!!loadingAction}
                    className="text-xs hover:bg-white/5"
                 >
                    {loadingAction === 'score' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Rescore
                 </Button>
                 <div className="w-px h-4 bg-white/10"></div>
                 <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleRecalculate('evaluation')}
                    disabled={!!loadingAction}
                    className="text-xs hover:bg-white/5"
                 >
                    {loadingAction === 'evaluation' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Re-evaluate
                 </Button>
                 <div className="w-px h-4 bg-white/10"></div>
                 <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleRecalculate('full')}
                    disabled={!!loadingAction}
                    className="text-xs hover:bg-white/5 text-amber-500 hover:text-amber-400"
                 >
                    {loadingAction === 'full' && <Loader2 className="w-3 h-3 animate-spin mr-1"/>}
                    Full Re-run
                 </Button>
             </div>
             
             <Button variant="primary" onClick={onClose}>
                 Close
             </Button>
        </div>

      </Card>
      </div>,
      document.body
  );
}
