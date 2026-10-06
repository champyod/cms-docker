'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Archive } from 'lucide-react';
import { batchUploadTestcases } from '@/app/actions/testcase-bulk';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import type { FileEncoding } from '@/lib/file-encoding';
import { validatePattern } from '@/utils/filenameParser';
import { pairToUploadData } from './testcase-helpers';
import { pairLocalFiles, pairZipFile } from './testcase-upload';
import type { FilePair } from './testcase-helpers';
import { TestcaseUploadMethodStep } from './TestcaseUploadMethodStep';
import { TestcasePatternInputs } from './TestcasePatternInputs';
import { TestcasePairsList } from './TestcasePairsList';
import { TestcasePreviewDialog } from './TestcasePreviewDialog';

interface TestcaseUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: number;
  onSuccess: () => void;
}

export function TestcaseUploadModal({ isOpen, onClose, datasetId, onSuccess }: TestcaseUploadModalProps): React.JSX.Element | null {
  const [step, setStep] = useState<1 | 2>(1);
  const [uploadType, setUploadType] = useState<'files' | 'zip'>('files');
  const [inputPattern, setInputPattern] = useState('*.in');
  const [outputPattern, setOutputPattern] = useState('*.out');
  const [inputPatternError, setInputPatternError] = useState('');
  const [outputPatternError, setOutputPatternError] = useState('');
  const [patternsPasted, setPatternsPasted] = useState(false);
  const [pairs, setPairs] = useState<FilePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [previewPairId, setPreviewPairId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastedPatternsRef = useRef(false);
  const selectedFilesRef = useRef<{ uploadType: 'files' | 'zip'; files: File[] } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setPairs([]);
    setLoading(false);
    setProcessing(false);
    setPreviewPairId(null);
    setInputPatternError('');
    setOutputPatternError('');
    setPatternsPasted(false);
    selectedFilesRef.current = null;
  }, [isOpen]);

  const processFilesList = async (files: File[]): Promise<void> => {
    setProcessing(true);
    try {
      setPairs(await pairLocalFiles(files, inputPattern, outputPattern));
    } catch (error) {
      console.error(error);
      toast.error('Failed to process files');
    } finally {
      setProcessing(false);
    }
  };

  const processZip = async (file: File): Promise<void> => {
    setProcessing(true);
    try {
      setPairs(await pairZipFile(file, inputPattern, outputPattern));
    } catch (error) {
      console.error(error);
      toast.error('Failed to process zip file');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    selectedFilesRef.current = { uploadType, files };
    if (uploadType === 'zip') void processZip(files[0]);
    else void processFilesList(files);
  };

  const handlePatternChange = (side: 'input' | 'output', value: string): void => {
    const setValue = side === 'input' ? setInputPattern : setOutputPattern;
    const setLint = side === 'input' ? setInputPatternError : setOutputPatternError;
    if (pastedPatternsRef.current) {
      pastedPatternsRef.current = false;
      setPatternsPasted(true);
      setValue(value);
      setLint('');
      return;
    }
    setPatternsPasted(false);
    setValue(value);
    setLint(validatePattern(value));
  };

  useEffect(() => {
    const selection = selectedFilesRef.current;
    if (!selection || inputPatternError || outputPatternError) return;
    const rebuildPairs = async (): Promise<void> => {
      setProcessing(true);
      try {
        setPairs(selection.uploadType === 'zip'
          ? await pairZipFile(selection.files[0], inputPattern, outputPattern)
          : await pairLocalFiles(selection.files, inputPattern, outputPattern));
      } catch (error) {
        console.error(error);
        toast.error('Failed to process files');
      } finally {
        setProcessing(false);
      }
    };
    void rebuildPairs();
  }, [inputPattern, outputPattern, inputPatternError, outputPatternError]);

  const updatePairEncoding = (pairId: string, side: 'input' | 'output', encoding: FileEncoding): void => {
    setPairs((previous) =>
      previous.map((pair) => {
        if (pair.id !== pairId) return pair;
        const next = { ...pair };
        const target = side === 'input' ? next.inputFile : next.outputFile;
        if (target) target.selectedEncoding = encoding;
        return next;
      })
    );
  };

  const runAction = useActionFeedback();

  const handleUpload = async (): Promise<void> => {
    const readyPairs = pairs.filter((pair) => pair.status === 'ready');
    if (readyPairs.length === 0) return;
    setLoading(true);
    try {
      const uploadData = await Promise.all(readyPairs.map((pair) => pairToUploadData(pair)));
      const result = await runAction(
        {
          pending: `Uploading ${readyPairs.length} testcases...`,
          success: 'Testcases uploaded',
          failure: 'Upload failed',
          description: `${readyPairs.length} pairs saved successfully.`,
        },
        () => batchUploadTestcases(datasetId, uploadData)
      );
      if (!result) return;
      if (result.success) {
        const skipped = result.details?.filter((d) => d.status === 'skipped').length ?? 0;
        if (skipped > 0) {
          toast.warning(`${skipped} pairs skipped`, { description: 'They already exist in this dataset.' });
        }
        onSuccess();
        onClose();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const previewPair = previewPairId ? (pairs.find((pair) => pair.id === previewPairId) ?? null) : null;
  if (!isOpen) return null;

  const readyCount = pairs.filter((p) => p.status === 'ready').length;

  // Why the guard: a submit already in flight cannot be recalled, so cancelling
  // through it would close the dialog over an unresolved upload. The same pair
  // of flags reaches the footer's cancelDisabled, so both states agree.
  const cancel = (): void => {
    if (!loading && !processing) { setPreviewPairId(null); onClose(); }
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
            confirmDisabled={loading || processing || step === 1 || readyCount === 0}
            cancelDisabled={loading || processing}
          />
        }
        className="flex max-h-[70vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-3xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 1 ? (
            <TestcaseUploadMethodStep
              onSelect={(uploadType) => {
                setUploadType(uploadType);
                setStep(2);
              }}
            />
          ) : (
            <div className="flex min-h-0 flex-1 animate-in slide-in-from-right flex-col overflow-hidden duration-300">
              <TestcasePatternInputs
                inputPattern={inputPattern}
                outputPattern={outputPattern}
                inputError={inputPatternError}
                outputError={outputPatternError}
                pastedNotice={patternsPasted}
                onPasteCapture={() => { pastedPatternsRef.current = true; }}
                onInputChange={(value) => handlePatternChange('input', value)}
                onOutputChange={(value) => handlePatternChange('output', value)}
                onBackToMethod={() => setStep(1)}
              />

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div onClick={() => fileInputRef.current?.click()} className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 transition-all hover:bg-muted/50 hover:border-ring/50">
                  {uploadType === 'zip' ? <Archive className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-info" /> : <Upload className="h-8 w-8 text-muted-foreground transition-colors group-hover:text-info" />}
                  <p className="font-medium text-muted-foreground">{uploadType === 'zip' ? 'Click to select Zip file' : 'Click to select Input/Output files'}</p>
                  <input ref={fileInputRef} type="file" multiple={uploadType === 'files'} accept={uploadType === 'zip' ? '.zip' : '.in,.out,.inp,.sol'} title="Select testcase files" aria-label="Select testcase files" className="hidden" onChange={handleFileSelect} />
                </div>

                {processing && (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <span className="text-sm">Processing files...</span>
                  </div>
                )}

                {!processing && <TestcasePairsList pairs={pairs} onPreview={setPreviewPairId} />}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {previewPair && <TestcasePreviewDialog pair={previewPair} onClose={() => setPreviewPairId(null)} onUpdateEncoding={updatePairEncoding} />}
    </>
  );
}
