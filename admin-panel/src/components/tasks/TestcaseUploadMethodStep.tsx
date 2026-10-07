'use client';

import { Archive, File as FileIcon } from 'lucide-react';

interface TestcaseUploadMethodStepProps {
  onSelect: (uploadType: 'files' | 'zip') => void;
}

export function TestcaseUploadMethodStep({ onSelect }: TestcaseUploadMethodStepProps): React.JSX.Element {
  return (
    <div className="flex flex-1 animate-in fade-in zoom-in flex-col items-center justify-center gap-6 p-8 duration-300">
      <h3 className="text-xl font-medium text-foreground">Select Upload Method</h3>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <button onClick={() => onSelect('files')} className="group flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/50 p-8 transition-all hover:border-ring/50 hover:bg-accent">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-info/10 transition-transform group-hover:scale-110">
            <FileIcon className="h-8 w-8 text-info" />
          </div>
          <div className="text-center">
            <h4 className="text-lg font-bold text-foreground">Multiple Files</h4>
            <p className="mt-1 text-sm text-muted-foreground">Select .in and .out files directly</p>
          </div>
        </button>
        <button onClick={() => onSelect('zip')} className="group flex flex-col items-center gap-4 rounded-xl border border-border bg-muted/50 p-8 transition-all hover:border-ring/50 hover:bg-accent">
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
  );
}
