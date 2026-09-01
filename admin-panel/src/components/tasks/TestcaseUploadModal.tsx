'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Check, AlertCircle, Archive, File as FileIcon, Settings } from 'lucide-react';
import JSZip from 'jszip';
import { batchUploadTestcases } from '@/app/actions/testcases';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { getEncodingLabel } from '@/lib/file-encoding';
import type { FileEncoding } from '@/lib/file-encoding';
import { buildPairs, readBlobBytes, pairToUploadData } from './testcase-helpers';
import type { FilePair, SourceItem } from './testcase-helpers';
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
  const [pairs, setPairs] = useState<FilePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [previewPairId, setPreviewPairId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setPairs([]);
    setLoading(false);
    setProcessing(false);
    setPreviewPairId(null);
  }, [isOpen]);

  const processFilesList = async (files: File[]): Promise<void> => {
    setProcessing(true);
    try {
      const sourceItems: SourceItem[] = files.map((file) => ({ name: file.name, getBytes: () => readBlobBytes(file) }));
      setPairs(await buildPairs(sourceItems, inputPattern, outputPattern));
    } catch (error) {
      console.error(error);
      alert('Failed to process files');
    } finally {
      setProcessing(false);
    }
  };

  const processZip = async (file: File): Promise<void> => {
    setProcessing(true);
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const sourceItems: SourceItem[] = [];
      for (const [filename, zipEntry] of Object.entries(content.files)) {
        if (zipEntry.dir || filename.startsWith('__MACOSX')) continue;
        const cleanName = filename.split('/').pop() ?? filename;
        sourceItems.push({ name: cleanName, getBytes: async () => zipEntry.async('uint8array') });
      }
      setPairs(await buildPairs(sourceItems, inputPattern, outputPattern));
    } catch (error) {
      console.error(error);
      alert('Failed to process zip file');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (!e.target.files?.length) return;
    if (uploadType === 'zip') void processZip(e.target.files[0]);
    else void processFilesList(Array.from(e.target.files));
  };

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

  const handleUpload = async (): Promise<void> => {
    const readyPairs = pairs.filter((pair) => pair.status === 'ready');
    if (readyPairs.length === 0) return;
    setLoading(true);
    try {
      const uploadData = await Promise.all(readyPairs.map((pair) => pairToUploadData(pair)));
      const result = await batchUploadTestcases(datasetId, uploadData);
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        alert(`Upload failed: ${result.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const previewPair = previewPairId ? (pairs.find((pair) => pair.id === previewPairId) ?? null) : null;
  if (!isOpen) return null;

  const readyCount = pairs.filter((p) => p.status === 'ready').length;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Upload Testcases"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => { setPreviewPairId(null); onClose(); }} disabled={loading || processing}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="positive"
              icon={Upload}
              loading={loading}
              disabled={loading || processing || step === 1 || readyCount === 0}
              onClick={handleUpload}
            >
              Upload {readyCount} Pairs
            </Button>
          </>
        }
        className="flex h-96 w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 1 ? (
            <div className="flex flex-1 animate-in fade-in zoom-in flex-col items-center justify-center gap-6 p-8 duration-300">
              <h3 className="text-xl font-medium text-foreground">Select Upload Method</h3>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
                <button onClick={() => { setUploadType('files'); setStep(2); }} className="group flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/50 p-8 transition-all hover:border-ring/50 hover:bg-accent">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-info/10 transition-transform group-hover:scale-110">
                    <FileIcon className="h-8 w-8 text-info" />
                  </div>
                  <div className="text-center">
                    <h4 className="text-lg font-bold text-foreground">Multiple Files</h4>
                    <p className="mt-1 text-sm text-muted-foreground">Select .in and .out files directly</p>
                  </div>
                </button>
                <button onClick={() => { setUploadType('zip'); setStep(2); }} className="group flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/50 p-8 transition-all hover:border-ring/50 hover:bg-accent">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-info/10 transition-transform group-hover:scale-110">
                    <Archive className="h-8 w-8 text-info" />
                  </div>
                  <div className="text-center">
                    <h4 className="text-lg font-bold text-foreground">Zip Archive</h4>
                    <p className="mt-1 text-sm text-muted-foreground">Upload a single .zip file</p>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 animate-in slide-in-from-right flex-col overflow-hidden duration-300">
              <div className="flex flex-wrap items-end gap-4 border-b border-border bg-muted/20 p-4">
                <div className="min-w-50 flex-1">
                  <label className="mb-1.5 block text-xs font-bold uppercase text-muted-foreground">Input Pattern</label>
                  <input type="text" value={inputPattern} onChange={(event) => setInputPattern(event.target.value)} className="w-full rounded border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" placeholder="e.g. *.in" />
                  <p className="mt-1 text-xs text-muted-foreground">Use * for number, ** for 2-digit number</p>
                </div>
                <div className="min-w-50 flex-1">
                  <label className="mb-1.5 block text-xs font-bold uppercase text-muted-foreground">Output Pattern</label>
                  <input type="text" value={outputPattern} onChange={(event) => setOutputPattern(event.target.value)} className="w-full rounded border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none" placeholder="e.g. *.out" />
                </div>
                <div className="pb-0.5">
                  <button onClick={() => setStep(1)} className="text-xs text-muted-foreground underline hover:text-foreground">Change Method</button>
                </div>
              </div>

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

                {!processing && pairs.length > 0 && (
                  <div className="space-y-2">
                    <div className="sticky top-0 z-10 flex items-center justify-between bg-card px-2 py-2 text-xs font-bold uppercase text-muted-foreground">
                      <span>Matched Pairs ({pairs.length})</span>
                      <span>Status</span>
                    </div>
                    {pairs.map((pair) => (
                      <div key={pair.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold', pair.status === 'ready' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>{pair.id}</div>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="truncate text-xs text-muted-foreground">In: <span className={pair.inputFile ? 'text-foreground' : 'text-destructive'}>{pair.inputFile?.name ?? 'Missing'}</span></span>
                            <span className="truncate text-xs text-muted-foreground">Out: <span className={pair.outputFile ? 'text-foreground' : 'text-destructive'}>{pair.outputFile?.name ?? 'Missing'}</span></span>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {pair.inputFile && <span>Input: <span className="text-info">{getEncodingLabel(pair.inputFile.selectedEncoding)}</span><span className="text-muted-foreground"> (detected {getEncodingLabel(pair.inputFile.detectedEncoding)})</span></span>}
                              {pair.outputFile && <span>Output: <span className="text-info">{getEncodingLabel(pair.outputFile.selectedEncoding)}</span><span className="text-muted-foreground"> (detected {getEncodingLabel(pair.outputFile.detectedEncoding)})</span></span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button onClick={() => setPreviewPairId(pair.id)} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent">
                            <Settings className="w-3.5 h-3.5" />
                            Preview
                          </button>
                          {pair.status === 'ready' && <Check className="h-4 w-4 text-success" />}
                          {(pair.status === 'missing_input' || pair.status === 'missing_output') && <AlertCircle className="h-4 w-4 text-destructive" />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {previewPair && <TestcasePreviewDialog pair={previewPair} onClose={() => setPreviewPairId(null)} onUpdateEncoding={updatePairEncoding} />}
    </>
  );
}
