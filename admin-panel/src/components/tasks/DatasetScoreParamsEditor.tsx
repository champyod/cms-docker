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
  const [codePushed, setCodePushed] = useState(false);
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [codeText, setCodeText] = useState('');
  const [sumValue, setSumValue] = useState<string>(() =>
    typeof params === 'number' ? String(params) : '',
  );
  const [rows, setRows] = useState<SubtaskRow[]>(() => paramsToRows(params));

  // Why adjust during render instead of an effect: switching score type or
  // picking another dataset replaces the params behind the editor, and stale
  // rows would write back old values. Edits pushed from the code view skip
  // the rewrite so typing is not reformatted on every valid keystroke.
  const signature = `${scoreType}:${JSON.stringify(params) ?? ''}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    if (!codePushed) {
      setRows(paramsToRows(params));
      if (typeof params === 'number') setSumValue(String(params));
      if (view === 'code') setCodeText(JSON.stringify(params, null, 2) ?? '');
    }
    setCodePushed(false);
  }

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

  const handleCodeChange = (value: string): void => {
    pastedRef.current = false;
    setPastedNotice(false);
    setCodeText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      onLintError('Score parameters must be valid JSON.');
      return;
    }
    setCodePushed(false);
    if (scoreType === 'Sum') {
      if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1) {
        onLintError('Sum multiplier must be an integer >= 1.');
        return;
      }
      setCodePushed(true);
      setSumValue(String(parsed));
      onParamsChange(parsed);
      onLintError('');
      return;
    }
    if (!Array.isArray(parsed)) {
      onLintError('Grouped score types need an array of [max score, testcases] rows.');
      return;
    }
    const next = paramsToRows(parsed);
    setCodePushed(true);
    setRows(next);
    onParamsChange(rowsToParams(next, scoreType));
    onLintError(lintSubtaskRows(next, scoreType));
  };

  return (
    <div onPasteCapture={() => { pastedRef.current = true; }}>
      <div className="flex items-center gap-1 mb-3">
        <button
          type="button"
          onClick={() => setView('visual')}
          className={view === 'visual' ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary' : 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted'}
        >
          Visual
        </button>
        <button
          type="button"
          onClick={() => { setCodeText(JSON.stringify(params, null, 2) ?? ''); setView('code'); }}
          className={view === 'code' ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary' : 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted'}
        >
          JSON
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{SCORE_PARAM_HELPERS[scoreType] ?? 'Configure the score parameters.'}</p>
      {view === 'code' ? (
        <textarea
          value={codeText}
          onChange={(e) => handleCodeChange(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground font-mono text-sm focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
          placeholder='e.g. [[30, 3], [70, 5]]'
        />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
