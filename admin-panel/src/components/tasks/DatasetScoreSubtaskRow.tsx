'use client';

import { Trash2 } from 'lucide-react';
import type { SubtaskRow } from './dataset-score-params';

interface DatasetScoreSubtaskRowProps {
  row: SubtaskRow;
  index: number;
  scoreType: string;
  canRemove: boolean;
  onFieldChange: (index: number, field: keyof SubtaskRow, value: string) => void;
  onRemove: (index: number) => void;
}

export function DatasetScoreSubtaskRow({
  row,
  index,
  scoreType,
  canRemove,
  onFieldChange,
  onRemove,
}: DatasetScoreSubtaskRowProps): React.JSX.Element {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Max score</label>
        <input
          type="number"
          min="0"
          step="any"
          value={row.maxScore}
          onChange={(e) => onFieldChange(index, 'maxScore', e.target.value)}
          className="w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
          placeholder="e.g. 40"
        />
      </div>
      <div className="flex-1">
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Testcases</label>
        <input
          type="text"
          value={row.testcases}
          onChange={(e) => onFieldChange(index, 'testcases', e.target.value)}
          className="w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
          placeholder="3 or subtask1_.*"
        />
      </div>
      {scoreType === 'GroupThreshold' && (
        <div className="flex-1">
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Threshold</label>
          <input
            type="number"
            min="0"
            max="1"
            step="any"
            value={row.threshold}
            onChange={(e) => onFieldChange(index, 'threshold', e.target.value)}
            className="w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            placeholder="e.g. 1"
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        aria-label={`Remove subtask ${index + 1}`}
        className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-30"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
