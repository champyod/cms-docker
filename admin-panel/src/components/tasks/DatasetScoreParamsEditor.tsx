'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DatasetScoreSubtaskRow } from './DatasetScoreSubtaskRow';
import { SubtaskBoard } from './SubtaskBoard';
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
  testcases?: readonly string[];
  onParamsChange: (params: unknown) => void;
  onLintError: (error: string) => void;
}

type EditorView = 'board' | 'visual' | 'code';

export function DatasetScoreParamsEditor({ scoreType, params, testcases = [], onParamsChange, onLintError }: EditorProps): React.JSX.Element {
  const pastedRef = useRef(false);
  const [pastedNotice, setPastedNotice] = useState(false);
  const [codePushed, setCodePushed] = useState(false);
  const [view, setView] = useState<EditorView>(() => (testcases.length > 0 && scoreType !== 'Sum' ? 'board' : 'visual'));
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

  // Why the guard: Sum holds a single multiplier, not subtask rows,
  // so a stale board view must fall back to the rows view instead of
  // rendering one meaningless group.
  const effectiveView = view === 'board' && scoreType === 'Sum' ? 'visual' : view;

  return (
    <div onPasteCapture={() => { pastedRef.current = true; }}>
      <div className="flex items-center gap-1 mb-3">
        {testcases.length > 0 && scoreType !== 'Sum' && (
          <button
            type="button"
            onClick={() => setView('board')}
            className={effectiveView === 'board' ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary' : 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted'}
          >
            Board
          </button>
        )}
        <button
          type="button"
          onClick={() => setView('visual')}
          className={effectiveView === 'visual' ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary' : 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted'}
        >
          Rows
        </button>
        <button
          type="button"
          onClick={() => { setCodeText(JSON.stringify(params, null, 2) ?? ''); setView('code'); }}
          className={effectiveView === 'code' ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-primary/15 text-primary' : 'px-3 py-1 rounded-lg text-xs text-muted-foreground hover:bg-muted'}
        >
          JSON
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{SCORE_PARAM_HELPERS[scoreType] ?? 'Configure the score parameters.'}</p>
      {effectiveView === 'code' ? (
        <textarea
          value={codeText}
          onChange={(e) => handleCodeChange(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-lg text-foreground font-mono text-sm focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
          placeholder='e.g. [[30, 3], [70, 5]]'
        />
      ) : effectiveView === 'board' ? (
        <SubtaskBoard
          scoreType={scoreType}
          rows={rows}
          testcases={testcases}
          onRowsChange={(next) => applyRows(next, lintSubtaskRows(next, scoreType))}
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
            <DatasetScoreSubtaskRow
              key={index}
              row={row}
              index={index}
              scoreType={scoreType}
              canRemove={rows.length > 1}
              onFieldChange={handleRowChange}
              onRemove={handleRemoveRow}
            />
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
