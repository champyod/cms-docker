'use client';

import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  SCORE_PARAM_HELPERS,
  defaultSubtaskRow,
  lintSubtaskRows,
  paramsToRows,
  rowsToParams,
  type SubtaskRow,
} from './dataset-score-params';

interface EditorProps {
  scoreType: string;
  params: unknown;
  onParamsChange: (params: unknown) => void;
  onLintError: (error: string) => void;
}

export function DatasetScoreParamsEditor({ scoreType, params, onParamsChange, onLintError }: EditorProps): React.JSX.Element {
  const pastedRef = useRef(false);
  const [pastedNotice, setPastedNotice] = useState(false);
  const [sumValue, setSumValue] = useState<string>(() =>
    typeof params === 'number' ? String(params) : '',
  );
  const [rows, setRows] = useState<SubtaskRow[]>(() => paramsToRows(params));

  const applyRows = (next: SubtaskRow[], lint: string): void => {
    setRows(next);
    onParamsChange(rowsToParams(next, scoreType));
    onLintError(lint);
  };

  const handleRowChange = (index: number, field: keyof SubtaskRow, value: string): void => {
    const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row));
    if (pastedRef.current) {
      pastedRef.current = false;
      setPastedNotice(true);
      setRows(next);
      onParamsChange(rowsToParams(next, scoreType));
      onLintError('');
      return;
    }
    setPastedNotice(false);
    applyRows(next, lintSubtaskRows(next, scoreType));
  };

  const handleSumChange = (value: string): void => {
    if (pastedRef.current) {
      pastedRef.current = false;
      setPastedNotice(true);
      setSumValue(value);
      onParamsChange(value.trim() === '' ? [] : Number(value));
      onLintError('');
      return;
    }
    setPastedNotice(false);
    setSumValue(value);
    if (value.trim() === '') {
      onParamsChange([]);
      onLintError('');
      return;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      onParamsChange([]);
      onLintError('Sum multiplier must be an integer >= 1.');
      return;
    }
    onParamsChange(parsed);
    onLintError('');
  };

  const handleAddRow = (): void => {
    const next = [...rows, defaultSubtaskRow()];
    applyRows(next, lintSubtaskRows(next, scoreType));
  };

  const handleRemoveRow = (index: number): void => {
    if (rows.length <= 1) return;
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    applyRows(next, lintSubtaskRows(next, scoreType));
  };

  return (
    <div onPasteCapture={() => { pastedRef.current = true; }}>
      <p className="text-xs text-muted-foreground mb-3">{SCORE_PARAM_HELPERS[scoreType] ?? 'Configure the score parameters.'}</p>
      {pastedNotice && (
        <p className="text-xs text-info mb-3">Pasted content applied without lint. Edit manually to re-lint.</p>
      )}
      {scoreType === 'Sum' ? (
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Multiplier</label>
          <input
            type="number"
            min="1"
            step="1"
            value={sumValue}
            onChange={(e) => handleSumChange(e.target.value)}
            className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
            placeholder="e.g. 100"
          />
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Max score</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={row.maxScore}
                  onChange={(e) => handleRowChange(index, 'maxScore', e.target.value)}
                  className="w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                  placeholder="e.g. 40"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Testcases</label>
                <input
                  type="text"
                  value={row.testcases}
                  onChange={(e) => handleRowChange(index, 'testcases', e.target.value)}
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
                    onChange={(e) => handleRowChange(index, 'threshold', e.target.value)}
                    className="w-full px-3 py-2 bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
                    placeholder="e.g. 1"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemoveRow(index)}
                disabled={rows.length <= 1}
                aria-label={`Remove subtask ${index + 1}`}
                className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-30"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddRow}
            className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 text-muted-foreground rounded-lg text-sm hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add subtask
          </button>
        </div>
      )}
    </div>
  );
}
