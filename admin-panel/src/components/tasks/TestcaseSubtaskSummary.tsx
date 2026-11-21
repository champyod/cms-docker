'use client';

import { rowsToParams, type SubtaskRow } from './dataset-score-params';
import type { UploadSubtaskGroup } from './subtask-board';

interface TestcaseSubtaskSummaryProps {
  groups: readonly UploadSubtaskGroup[];
  rows: readonly SubtaskRow[];
  scoreType: string;
  applySubtasks: boolean;
  onApplyChange: (value: boolean) => void;
}

export function TestcaseSubtaskSummary({
  groups,
  rows,
  scoreType,
  applySubtasks,
  onApplyChange,
}: TestcaseSubtaskSummaryProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          Detected subtasks ({groups.length})
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={applySubtasks}
            onChange={(e) => onApplyChange(e.target.checked)}
            className="rounded border-border"
          />
          Set subtask scores from groups
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <span
            key={group.name}
            className="rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground"
          >
            {group.name} · {group.testcases.length}
          </span>
        ))}
      </div>
      {applySubtasks && (
        <div>
          <span className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">
            Score parameters to apply
          </span>
          <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-muted/40 p-2 font-mono text-xs text-foreground">
{JSON.stringify(rowsToParams(rows, scoreType), null, 2)}
          </pre>
          <p className="text-xs text-muted-foreground mt-1.5">
            Adjust the points per subtask in the dataset editor after the upload.
          </p>
        </div>
      )}
    </div>
  );
}
