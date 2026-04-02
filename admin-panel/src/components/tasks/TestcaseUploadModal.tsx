'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Upload, FileText, Check, AlertCircle, Loader, Archive, File as FileIcon, Settings } from 'lucide-react';
import JSZip from 'jszip';

import { batchUploadTestcases } from '@/app/actions/testcases';
import { Portal } from '../core/Portal';
import {
  detectFileEncoding,
  decodeFileBytes,
  ENCODING_OPTIONS,
  FileEncoding,
  getEncodingLabel,
  normalizeFileBytes,
} from '@/lib/file-encoding';
import { parseFilename } from '@/utils/filenameParser';

interface TestcaseUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: number;
  onSuccess: () => void;
}

interface EncodedFile {
  name: string;
  bytes: Uint8Array;
  detectedEncoding: FileEncoding;
  selectedEncoding: FileEncoding;
}

interface FilePair {
  id: string;
  inputFile?: EncodedFile;
  outputFile?: EncodedFile;
  status: 'ready' | 'missing_output' | 'missing_input' | 'error';
}

interface SourceItem {
  name: string;
  getBytes: () => Promise<Uint8Array>;
}

export function TestcaseUploadModal({ isOpen, onClose, datasetId, onSuccess }: TestcaseUploadModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [uploadType, setUploadType] = useState<'files' | 'zip'>('files');

  const [inputPattern, setInputPattern] = useState('*.in');
  const [outputPattern, setOutputPattern] = useState('*.out');

  const [pairs, setPairs] = useState<FilePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [previewPairId, setPreviewPairId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setPairs([]);
      setLoading(false);
      setProcessing(false);
      setPreviewPairId(null);
    }
  }, [isOpen]);

  const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
    return new Uint8Array(await blob.arrayBuffer());
  };

  const toBase64 = (bytes: Uint8Array): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(new Blob([bytes]));
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error('Failed to convert file'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const createEncodedFile = (name: string, bytes: Uint8Array): EncodedFile => {
    const detectedEncoding = detectFileEncoding(bytes);
    return {
      name,
      bytes,
      detectedEncoding,
      selectedEncoding: detectedEncoding,
    };
  };

  const buildPairs = async (sourceItems: SourceItem[]) => {
    const pairMap: Record<string, Partial<FilePair>> = {};

    for (const item of sourceItems) {
      const bytes = await item.getBytes();
      const inputId = parseFilename(item.name, inputPattern);
      const outputId = parseFilename(item.name, outputPattern);

      if (inputId) {
        if (!pairMap[inputId]) pairMap[inputId] = { id: inputId };
        pairMap[inputId].inputFile = createEncodedFile(item.name, bytes);
      } else if (outputId) {
        if (!pairMap[outputId]) pairMap[outputId] = { id: outputId };
        pairMap[outputId].outputFile = createEncodedFile(item.name, bytes);
      }
    }

    return Object.values(pairMap)
      .map(pair => {
        const resolvedPair = pair as FilePair;
        if (!resolvedPair.inputFile) resolvedPair.status = 'missing_input';
        else if (!resolvedPair.outputFile) resolvedPair.status = 'missing_output';
        else resolvedPair.status = 'ready';
        return resolvedPair;
      })
      .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  };

  const processFilesList = async (files: File[]) => {
    setProcessing(true);
    try {
      const sourceItems: SourceItem[] = files.map(file => ({
        name: file.name,
        getBytes: () => readBlobBytes(file),
      }));
      setPairs(await buildPairs(sourceItems));
    } catch (error) {
      console.error(error);
      alert('Failed to process files');
    } finally {
      setProcessing(false);
    }
  };

  const processZip = async (file: File) => {
    setProcessing(true);
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const sourceItems: SourceItem[] = [];

      for (const [filename, zipEntry] of Object.entries(content.files)) {
        if (zipEntry.dir) continue;
        if (filename.startsWith('__MACOSX')) continue;

        const cleanName = filename.split('/').pop() || filename;
        sourceItems.push({
          name: cleanName,
          getBytes: async () => zipEntry.async('uint8array'),
        });
      }

      setPairs(await buildPairs(sourceItems));
    } catch (error) {
      console.error(error);
      alert('Failed to process zip file');
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;

    if (uploadType === 'zip') {
      processZip(e.target.files[0]);
    } else {
      processFilesList(Array.from(e.target.files));
    }
  };

  const updatePairEncoding = (pairId: string, side: 'input' | 'output', encoding: FileEncoding) => {
    setPairs(previous => previous.map(pair => {
      if (pair.id !== pairId) {
        return pair;
      }

      const nextPair = { ...pair };
      const targetFile = side === 'input' ? nextPair.inputFile : nextPair.outputFile;
      if (targetFile) {
        targetFile.selectedEncoding = encoding;
      }
      return nextPair;
    }));
  };

  const handleUpload = async () => {
    const readyPairs = pairs.filter(pair => pair.status === 'ready');
    if (readyPairs.length === 0) return;

    setLoading(true);
    try {
      const uploadData = await Promise.all(readyPairs.map(async (pair) => {
        const inputFile = pair.inputFile;
        const outputFile = pair.outputFile;

        if (!inputFile || !outputFile) {
          throw new Error(`Pair ${pair.id} is missing input or output data`);
        }

        return {
          codename: pair.id,
          inputBase64: await toBase64(normalizeFileBytes(inputFile.bytes, inputFile.selectedEncoding)),
          outputBase64: await toBase64(normalizeFileBytes(outputFile.bytes, outputFile.selectedEncoding)),
          isPublic: false,
        };
      }));

      const result = await batchUploadTestcases(datasetId, uploadData);

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        alert('Upload failed: ' + result.error);
      }
    } catch (error) {
      console.error(error);
      alert('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const previewPair = previewPairId ? pairs.find(pair => pair.id === previewPairId) ?? null : null;

  const renderPreviewText = (file?: EncodedFile) => {
    if (!file) {
      return '';
    }

    const decoded = decodeFileBytes(file.bytes, file.selectedEncoding);
    return decoded.length > 4000 ? `${decoded.slice(0, 4000)}\n…` : decoded;
  };

  if (!isOpen) return null;

  return (
    <Portal>
      <>
        <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-3xl h-[85vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold text-white">Upload Testcases</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {step === 1 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6 animate-in fade-in zoom-in duration-300">
                <h3 className="text-xl font-medium text-white">Select Upload Method</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
                  <button
                    onClick={() => { setUploadType('files'); setStep(2); }}
                    className="p-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/50 rounded-2xl flex flex-col items-center gap-4 transition-all group"
                  >
                    <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileIcon className="w-8 h-8 text-cyan-400" />
                    </div>
                    <div className="text-center">
                      <h4 className="font-bold text-white text-lg">Multiple Files</h4>
                      <p className="text-neutral-400 text-sm mt-1">Select .in and .out files directly</p>
                    </div>
                  </button>

                  <button
                    onClick={() => { setUploadType('zip'); setStep(2); }}
                    className="p-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded-2xl flex flex-col items-center gap-4 transition-all group"
                  >
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
                {/* Config Bar */}
                <div className="p-4 bg-black/20 border-b border-white/5 flex flex-wrap gap-4 items-end">
                      <div className="flex-1 min-w-50">
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5 ">Input Pattern</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={inputPattern}
                        onChange={(e) => setInputPattern(e.target.value)}
                        className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-500/50"
                        placeholder="e.g. *.in"
                      />
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-1">Use * for number, ** for 2-digit number</p>
                  </div>
                      <div className="flex-1 min-w-50">
                    <label className="block text-xs font-bold text-neutral-500 uppercase mb-1.5">Output Pattern</label>
                    <input
                      type="text"
                      value={outputPattern}
                      onChange={(e) => setOutputPattern(e.target.value)}
                      className="w-full px-3 py-1.5 bg-black/40 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-cyan-500/50"
                      placeholder="e.g. *.out"
                    />
                  </div>
                  <div className="pb-0.5">
                    <button
                      onClick={() => setStep(1)}
                      className="text-xs text-neutral-400 hover:text-white underline"
                    >
                      Change Method
                    </button>
                  </div>
                </div>

                {/* Main Area */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Dropzone */}
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center gap-2 hover:bg-white/5 hover:border-cyan-500/50 transition-all cursor-pointer group"
                    >
                      {uploadType === 'zip' ? (
                        <Archive className="w-8 h-8 text-neutral-500 group-hover:text-purple-400 transition-colors" />
                      ) : (
                          <Upload className="w-8 h-8 text-neutral-500 group-hover:text-cyan-400 transition-colors" />
                      )}
                      <p className="text-neutral-400 font-medium">
                        {uploadType === 'zip' ? 'Click to select Zip file' : 'Click to select Input/Output files'}
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file" 
                        multiple={uploadType === 'files'}
                        accept={uploadType === 'zip' ? '.zip' : '.in,.out,.inp,.sol'}
                        className="hidden" 
                        onChange={handleFileSelect}
                      />
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
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${pair.status === 'ready' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                               {pair.id}
                             </div>
                              <div className="flex flex-col gap-1 min-w-0 flex-1">
                                <span className="text-xs text-neutral-400 truncate">
                                  In: <span className={pair.inputFile ? 'text-white' : 'text-red-400'}>{pair.inputFile?.name || 'Missing'}</span>
                               </span>
                                <span className="text-xs text-neutral-400 truncate">
                                  Out: <span className={pair.outputFile ? 'text-white' : 'text-red-400'}>{pair.outputFile?.name || 'Missing'}</span>
                               </span>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                                  {pair.inputFile && (
                                    <span>
                                      Input: <span className="text-cyan-300">{getEncodingLabel(pair.inputFile.selectedEncoding)}</span>
                                      <span className="text-neutral-600"> (detected {getEncodingLabel(pair.inputFile.detectedEncoding)})</span>
                                    </span>
                                  )}
                                  {pair.outputFile && (
                                    <span>
                                      Output: <span className="text-cyan-300">{getEncodingLabel(pair.outputFile.selectedEncoding)}</span>
                                      <span className="text-neutral-600"> (detected {getEncodingLabel(pair.outputFile.detectedEncoding)})</span>
                                    </span>
                                  )}
                                </div>
                             </div>
                           </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => setPreviewPairId(pair.id)}
                                className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-neutral-200 flex items-center gap-1.5 transition-colors"
                              >
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

                  {/* Footer */}
                  <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 shrink-0">
                    <button
                        onClick={() => {
                          setPreviewPairId(null);
                          onClose();
                        }}
                      className="px-6 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpload}
                      disabled={loading || processing || pairs.filter(p => p.status === 'ready').length === 0}
                      className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {loading && <Loader className="w-4 h-4 animate-spin" />}
                      Upload {pairs.filter(p => p.status === 'ready').length} Pairs
                    </button>
                  </div>
                </div>
                {previewPair && (
                <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={() => setPreviewPairId(null)}>
                  <div className="w-full max-w-5xl h-[88vh] bg-neutral-950 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
                    <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-cyan-400" />
                        <div>
                          <h3 className="text-lg font-bold text-white">Encoding Preview: {previewPair.id}</h3>
                          <p className="text-xs text-neutral-400">Choose the detected format or override it before upload.</p>
                        </div>
                      </div>
                      <button onClick={() => setPreviewPairId(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-neutral-400" />
                      </button>
                    </div>

                    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
                      {[
                        { label: 'Input', file: previewPair.inputFile, side: 'input' as const },
                        { label: 'Output', file: previewPair.outputFile, side: 'output' as const },
                      ].map(({ label, file, side }) => (
                        <div key={label} className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-white/10">
                          <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="font-semibold text-white">{label}</h4>
                              <p className="text-xs text-neutral-500 truncate max-w-xl">{file?.name || 'Missing file'}</p>
                            </div>
                            {file && (
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] text-neutral-500">Detected {getEncodingLabel(file.detectedEncoding)}</span>
                                <select
                                  value={file.selectedEncoding}
                                  onChange={event => updatePairEncoding(previewPair.id, side, event.target.value as FileEncoding)}
                                  className="px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                                >
                                  {ENCODING_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-h-0 overflow-auto p-4">
                            {!file ? (
                              <div className="h-full flex items-center justify-center text-neutral-500 text-sm">No file available.</div>
                            ) : (
                              <pre className="whitespace-pre-wrap wrap-break-word text-sm text-neutral-200 leading-6 font-mono bg-black/30 border border-white/5 rounded-xl p-4 min-h-full">
                                {renderPreviewText(file)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 border-t border-white/10 bg-black/40 flex items-center justify-between gap-3">
                      <div className="text-xs text-neutral-500">
                        Files are decoded for preview, then normalized to UTF-8 before upload.
                      </div>
                      <button
                        onClick={() => setPreviewPairId(null)}
                        className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors"
                      >
                        Close Preview
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </>
    </Portal>
  );
}
