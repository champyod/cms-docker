'use client';

import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Encoding Preview: ${pair.id}`}
      description="Choose the detected format or override it before upload."
      footer={
        <>
          <span className="text-xs text-muted-foreground">Files are decoded for preview, then normalized to UTF-8 before upload.</span>
          <Button type="button" variant="positive" onClick={onClose}>
            Close Preview
          </Button>
        </>
      }
      className="flex h-[88vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
        {[
          { label: 'Input', file: pair.inputFile, side: 'input' as const },
          { label: 'Output', file: pair.outputFile, side: 'output' as const },
        ].map(({ label, file, side }) => (
          <div key={label} className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 p-4">
              <div>
                <h4 className="font-semibold text-foreground">{label}</h4>
                <p className="max-w-xl truncate text-xs text-muted-foreground">{file?.name ?? 'Missing file'}</p>
              </div>
              {file && (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[11px] text-muted-foreground">Detected {getEncodingLabel(file.detectedEncoding)}</span>
                  <select
                    value={file.selectedEncoding}
                    onChange={(event) => onUpdateEncoding(pair.id, side, event.target.value as FileEncoding)}
                    aria-label={`${label} encoding selection`}
                    title={`${label} encoding selection`}
                    className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
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
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {!file ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No file available.</div>
              ) : (
                <pre className="min-h-full whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-4 font-mono text-sm leading-6 text-foreground">
                  {renderPreviewText(file)}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
