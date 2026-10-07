'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Archive } from 'lucide-react';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import type { BulkItemResult } from '@/app/actions/testcase-support';
import { apiClient } from '@/lib/apiClient';
import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { buildUploadFormData } from './testcase-upload';
import { buildUploadSubtaskRows, detectSubtaskGroups } from './subtask-board';
import { rowsToParams } from './dataset-score-params';
import { TestcaseUploadMethodStep } from './TestcaseUploadMethodStep';
import { TestcasePatternInputs } from './TestcasePatternInputs';
import { TestcasePairsList } from './TestcasePairsList';
import { TestcasePreviewDialog } from './TestcasePreviewDialog';
import { TestcaseSubtaskSummary } from './TestcaseSubtaskSummary';
import { useTestcaseUpload } from './useTestcaseUpload';

interface TestcaseUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: number;
  currentScoreType?: string;
  onSuccess: () => void;
}

export function TestcaseUploadModal({ isOpen, onClose, datasetId, currentScoreType = 'Sum', onSuccess }: TestcaseUploadModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<1 | 2>(1);
  const [applySubtasks, setApplySubtasks] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewPairId, setPreviewPairId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useTestcaseUpload(isOpen);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setStep(1);
      setApplySubtasks(false);
      setLoading(false);
      setPreviewPairId(null);
    }
  }

  // Why memoized: grouping walks every pair, and the pairs list
  // rebuilds on each pattern edit, so the map runs once per change.
  const detectedGroups = useMemo(() => detectSubtaskGroups(upload.pairs), [upload.pairs]);

  const targetScoreType = currentScoreType === 'Sum' ? 'GroupMin' : currentScoreType;
  const subtaskRows = useMemo(
    () => buildUploadSubtaskRows(detectedGroups, upload.pairs.map((pair) => pair.id)),
    [detectedGroups, upload.pairs],
  );

  const applySubtaskScores = async (): Promise<boolean> => {
    if (!applySubtasks || detectedGroups.length === 0) return true;
    try {
      const result = await apiClient.put(`/api/datasets/${datasetId}`, {
        action: 'update',
        score_type: targetScoreType,
        score_type_parameters: rowsToParams(subtaskRows, targetScoreType),
      });
      if (!result.success) {
        toast.error('Testcases uploaded, but subtask scores were not applied', { description: result.error });
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to apply subtask scores:', error);
      toast.error('Testcases uploaded, but subtask scores were not applied');
      return false;
    }
  };

  const runAction = useActionFeedback();

  const handleUpload = async (): Promise<void> => {
    const readyPairs = upload.pairs.filter((pair) => pair.status === 'ready');
    if (readyPairs.length === 0) return;
    setLoading(true);
    try {
      const result = await runAction(
        {
          pending: `Uploading ${readyPairs.length} testcases...`,
          success: 'Testcases uploaded',
          failure: 'Upload failed',
          description: `${readyPairs.length} pairs saved successfully.`,
        },
        async () => {
          const response = await apiClient.postFormData('/api/testcases', buildUploadFormData(readyPairs, datasetId));
          if (!response.success) {
            return { success: false as const, error: response.error };
          }
          const details = Array.isArray(response.details)
            ? (response.details as BulkItemResult[])
            : undefined;
          return { success: true as const, details };
        }
      );
      if (!result) return;
      if (result.success) {
        const skipped = result.details?.filter((d) => d.status === 'skipped').length ?? 0;
        if (skipped > 0) {
          toast.warning(`${skipped} pairs skipped`, { description: 'They already exist in this dataset.' });
        }
        await applySubtaskScores();
        onSuccess();
        onClose();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const previewPair = previewPairId ? (upload.pairs.find((pair) => pair.id === previewPairId) ?? null) : null;
  if (!isOpen) return null;

  const readyCount = upload.pairs.filter((pair) => pair.status === 'ready').length;

  // Why the guard: a submit already in flight cannot be recalled, so cancelling
  // through it would close the dialog over an unresolved upload.
  const cancel = (): void => {
    if (!loading && !upload.processing) { setPreviewPairId(null); onClose(); }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Upload Testcases"
        footer={
          <ModalFooter
            cancelLabel="Cancel"
            confirmLabel={`Upload ${readyCount} Pairs`}
            onCancel={cancel}
            onConfirm={handleUpload}
            confirmIcon={Upload}
            confirmLoading={loading}
            confirmDisabled={loading || upload.processing || step === 1 || readyCount === 0}
            cancelDisabled={loading || upload.processing}
          />
        }
        className="flex max-h-[70vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-3xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 1 ? (
            <TestcaseUploadMethodStep
              onSelect={(uploadType) => {
                upload.setUploadType(uploadType);
                setStep(2);
              }}
            />
          ) : (
            <div className="flex min-h-0 flex-1 animate-in slide-in-from-right flex-col overflow-hidden duration-300">
              <TestcasePatternInputs
                inputPattern={upload.inputPattern}
                outputPattern={upload.outputPattern}
                inputError={upload.inputPatternError}
                outputError={upload.outputPatternError}
                pastedNotice={upload.patternsPasted}
                onPasteCapture={() => { upload.markPatternsPasted(); }}
                onInputChange={(value) => upload.handlePatternChange('input', value)}
                onOutputChange={(value) => upload.handlePatternChange('output', value)}
                onBackToMethod={() => setStep(1)}
              />

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div onClick={() => fileInputRef.current?.click()} className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 transition-all hover:bg-muted/50 hover:border-ring/50">
                  {upload.uploadType === 'zip' ? <Archive className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-info" /> : <Upload className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-info" />}
                  <p className="font-medium text-muted-foreground">{upload.uploadType === 'zip' ? 'Click to select Zip file' : 'Click to select Input/Output files'}</p>
                  <input ref={fileInputRef} type="file" multiple={upload.uploadType === 'files'} accept={upload.uploadType === 'zip' ? '.zip' : '.in,.out,.inp,.sol'} title="Select testcase files" aria-label="Select testcase files" className="hidden" onChange={upload.handleFileSelect} />
                </div>

                {upload.processing && (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <span className="text-sm">Processing files...</span>
                  </div>
                )}

                {!upload.processing && <TestcasePairsList pairs={upload.pairs} onPreview={setPreviewPairId} />}

                {detectedGroups.length > 0 && (
                  <TestcaseSubtaskSummary
                    groups={detectedGroups}
                    rows={subtaskRows}
                    scoreType={targetScoreType}
                    applySubtasks={applySubtasks}
                    onApplyChange={setApplySubtasks}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {previewPair && <TestcasePreviewDialog pair={previewPair} onClose={() => setPreviewPairId(null)} onUpdateEncoding={upload.updatePairEncoding} />}
    </>
  );
}
