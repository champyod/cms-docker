'use client';

import { X, FileText } from 'lucide-react';
import { decodeFileBytes, ENCODING_OPTIONS, getEncodingLabel } from '@/lib/file-encoding';
import type { FileEncoding } from '@/lib/file-encoding';
import type { FilePair, EncodedFile } from './testcase-helpers';

interface PreviewDialogProps {
  pair: FilePair;
  onClose: () => void;
  onUpdateEncoding: (pairId: string, side: 'input' | 'output', encoding: FileEncoding) => void;
}

function renderPreviewText(file?: EncodedFile): string {
  if (!file) return '';
  const decoded = decodeFileBytes(file.bytes, file.selectedEncoding);
  return decoded.length > 4000 ? `${decoded.slice(0, 4000)}\n…` : decoded;
}

export function TestcasePreviewDialog({ pair, onClose, onUpdateEncoding }: PreviewDialogProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[88vh] bg-neutral-950 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-lg font-bold text-white">Encoding Preview: {pair.id}</h3>
              <p className="text-xs text-neutral-400">Choose the detected format or override it before upload.</p>
            </div>
          </div>
          <button onClick={onClose} title="Close preview" aria-label="Close preview" className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
          {[
            { label: 'Input', file: pair.inputFile, side: 'input' as const },
            { label: 'Output', file: pair.outputFile, side: 'output' as const },
          ].map(({ label, file, side }) => (
            <div key={label} className="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-white/10">
              <div className="p-4 border-b border-white/10 bg-black/20 flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-white">{label}</h4>
                  <p className="text-xs text-neutral-500 truncate max-w-xl">{file?.name ?? 'Missing file'}</p>
                </div>
                {file && (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] text-neutral-500">Detected {getEncodingLabel(file.detectedEncoding)}</span>
                    <select
                      value={file.selectedEncoding}
                      onChange={(event) => onUpdateEncoding(pair.id, side, event.target.value as FileEncoding)}
                      aria-label={`${label} encoding selection`}
                      title={`${label} encoding selection`}
                      className="px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                    >
                      {ENCODING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
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
          <div className="text-xs text-neutral-500">Files are decoded for preview, then normalized to UTF-8 before upload.</div>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors">
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
