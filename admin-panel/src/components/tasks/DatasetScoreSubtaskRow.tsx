'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
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
        <Input
          type="number"
          min="0"
          step="any"
          value={row.maxScore}
          onChange={(e) => onFieldChange(index, 'maxScore', e.target.value)}
          placeholder="e.g. 40"
        />
      </div>
      <div className="flex-1">
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Testcases</label>
        <Input
          type="text"
          value={row.testcases}
          onChange={(e) => onFieldChange(index, 'testcases', e.target.value)}
          placeholder="3 or subtask1_.*"
        />
      </div>
      {scoreType === 'GroupThreshold' && (
        <div className="flex-1">
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Threshold</label>
          <Input
            type="number"
            min="0"
            max="1"
            step="any"
            value={row.threshold}
            onChange={(e) => onFieldChange(index, 'threshold', e.target.value)}
            placeholder="e.g. 1"
          />
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        iconOnly
        icon={Trash2}
        tooltip={`Remove subtask ${index + 1}`}
        aria-label={`Remove subtask ${index + 1}`}
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        className="mb-0.5 size-9 shrink-0 rounded-lg hover:text-destructive"
      />
    </div>
  );
}
