'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Upload, Check, AlertCircle, Loader, Archive, File as FileIcon, Settings } from 'lucide-react';
import JSZip from 'jszip';
import { batchUploadTestcases } from '@/app/actions/testcases';
import { Portal } from '../core/Portal';
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

  return (
    <Portal>
      <>
        <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
          <div className="relative z-10 w-full max-w-3xl h-[85vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-bold text-white">Upload Testcases</h2>
              </div>
              <button onClick={onClose} title="Close upload modal" aria-label="Close upload modal" className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-5 h-5 text-neutral-400" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {step === 1 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 animate-in fade-in zoom-in duration-300">
                  <h3 className="text-xl font-medium text-white">Select Upload Method</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
                    <button onClick={() => { setUploadType('files'); setStep(2); }} className="p-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/50 rounded-2xl flex flex-col items-center gap-4 transition-all group">
                      <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <FileIcon className="w-8 h-8 text-cyan-400" />
                      </div>
                      <div className="text-center">
                        <h4 className="font-bold text-white text-lg">Multiple Files</h4>
                        <p className="text-neutral-400 text-sm mt-1">Select .in and .out files directly</p>
                      </div>
                    </button>
                    <button onClick={() => { setUploadType('zip'); setStep(2); }} className="p-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded-2xl flex flex-col items-center gap-4 transition-all group">
                      <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Archive className="w-8 h-8 text-purple-400" />
                      </div>
                      <div className="text-center">
                        <h4 className="font-bold text-white text-lg">Zip Archive</h4>
                        <p className="text-neutral-400 text-sm mt-1">Upload a single .zip file</p>
                      </div>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                  <div className="p-4 bg-black/20 border-b border-white/5 flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-50">
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Input Pattern</label>
                      <input type="text" value={inputPattern} onChange={(event) => setInputPattern(event.target.value)} className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-500/50" placeholder="e.g. *.in" />
                      <p className="text-[10px] text-neutral-500 mt-1">Use * for number, ** for 2-digit number</p>
                    </div>
                    <div className="flex-1 min-w-50">
                      <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Output Pattern</label>
                      <input type="text" value={outputPattern} onChange={(event) => setOutputPattern(event.target.value)} className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-500/50" placeholder="e.g. *.out" />
                    </div>
                    <div className="pb-0.5">
                      <button onClick={() => setStep(1)} className="text-xs text-neutral-400 hover:text-white underline">Change Method</button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center gap-2 hover:bg-white/5 hover:border-cyan-500/50 transition-all cursor-pointer group">
                      {uploadType === 'zip' ? <Archive className="w-8 h-8 text-neutral-500 group-hover:text-purple-400 transition-colors" /> : <Upload className="w-8 h-8 text-neutral-500 group-hover:text-cyan-400 transition-colors" />}
                      <p className="text-neutral-400 font-medium">{uploadType === 'zip' ? 'Click to select Zip file' : 'Click to select Input/Output files'}</p>
                      <input ref={fileInputRef} type="file" multiple={uploadType === 'files'} accept={uploadType === 'zip' ? '.zip' : '.in,.out,.inp,.sol'} title="Select testcase files" aria-label="Select testcase files" className="hidden" onChange={handleFileSelect} />
                    </div>

                    {processing && (
                      <div className="flex items-center justify-center py-8 text-neutral-500 gap-2">
                        <Loader className="w-5 h-5 animate-spin" />
                        <span className="text-sm">Processing files...</span>
                      </div>
                    )}

                    {!processing && pairs.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-neutral-500 uppercase font-bold px-2 sticky top-0 bg-neutral-900 py-2 z-10">
                          <span>Matched Pairs ({pairs.length})</span>
                          <span>Status</span>
                        </div>
                        {pairs.map((pair) => (
                          <div key={pair.id} className="flex items-center justify-between gap-4 p-3 bg-black/30 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${pair.status === 'ready' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{pair.id}</div>
                              <div className="flex flex-col gap-1 min-w-0 flex-1">
                                <span className="text-xs text-neutral-400 truncate">In: <span className={pair.inputFile ? 'text-white' : 'text-red-400'}>{pair.inputFile?.name ?? 'Missing'}</span></span>
                                <span className="text-xs text-neutral-400 truncate">Out: <span className={pair.outputFile ? 'text-white' : 'text-red-400'}>{pair.outputFile?.name ?? 'Missing'}</span></span>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                                  {pair.inputFile && <span>Input: <span className="text-cyan-300">{getEncodingLabel(pair.inputFile.selectedEncoding)}</span><span className="text-neutral-600"> (detected {getEncodingLabel(pair.inputFile.detectedEncoding)})</span></span>}
                                  {pair.outputFile && <span>Output: <span className="text-cyan-300">{getEncodingLabel(pair.outputFile.selectedEncoding)}</span><span className="text-neutral-600"> (detected {getEncodingLabel(pair.outputFile.detectedEncoding)})</span></span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => setPreviewPairId(pair.id)} className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-neutral-200 flex items-center gap-1.5 transition-colors">
                                <Settings className="w-3.5 h-3.5" />
                                Preview
                              </button>
                              {pair.status === 'ready' && <Check className="w-4 h-4 text-emerald-400" />}
                              {(pair.status === 'missing_input' || pair.status === 'missing_output') && <AlertCircle className="w-4 h-4 text-red-400" />}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 shrink-0">
                    <button onClick={() => { setPreviewPairId(null); onClose(); }} className="px-6 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleUpload} disabled={loading || processing || pairs.filter((p) => p.status === 'ready').length === 0} className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
                      {loading && <Loader className="w-4 h-4 animate-spin" />}
                      Upload {pairs.filter((p) => p.status === 'ready').length} Pairs
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {previewPair && <TestcasePreviewDialog pair={previewPair} onClose={() => setPreviewPairId(null)} onUpdateEncoding={updatePairEncoding} />}
      </>
    </Portal>
  );
}
