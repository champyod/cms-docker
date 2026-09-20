'use client';

import { AlertCircle, Check, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getEncodingLabel } from '@/lib/file-encoding';
import type { FilePair } from './testcase-helpers';

interface PairsListProps {
  pairs: FilePair[];
  onPreview: (pairId: string) => void;
}

export function TestcasePairsList({ pairs, onPreview }: PairsListProps): React.JSX.Element | null {
  if (pairs.length === 0) return null;
  return (
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
            <button onClick={() => onPreview(pair.id)} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent">
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            {pair.status === 'ready' && <Check className="h-4 w-4 text-success" />}
            {(pair.status === 'missing_input' || pair.status === 'missing_output') && <AlertCircle className="h-4 w-4 text-destructive" />}
          </div>
        </div>
      ))}
    </div>
  );
}
