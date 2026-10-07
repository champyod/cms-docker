'use client';

interface PatternInputsProps {
  inputPattern: string;
  outputPattern: string;
  inputError: string;
  outputError: string;
  pastedNotice: boolean;
  onPasteCapture: () => void;
  onInputChange: (value: string) => void;
  onOutputChange: (value: string) => void;
  onBackToMethod: () => void;
}

export function TestcasePatternInputs({
  inputPattern,
  outputPattern,
  inputError,
  outputError,
  pastedNotice,
  onPasteCapture,
  onInputChange,
  onOutputChange,
  onBackToMethod,
}: PatternInputsProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start gap-4 border-b border-border bg-muted/20 p-4" onPasteCapture={onPasteCapture}>
      <div className="min-w-50 flex-1">
        <label className="mb-1.5 block text-xs font-bold uppercase text-muted-foreground">Input Pattern</label>
        <input
          type="text"
          value={inputPattern}
          onChange={(event) => onInputChange(event.target.value)}
          className="w-full rounded border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
          placeholder="e.g. case_*.in"
        />
        <p className="mt-1 text-xs text-muted-foreground">* = running number, ** = zero-padded 2-digit number. e.g. case_*.in turns case_3.in into codename 3.</p>
        {inputError && <p className="mt-1 text-xs text-destructive">{inputError}</p>}
      </div>
      <div className="min-w-50 flex-1">
        <label className="mb-1.5 block text-xs font-bold uppercase text-muted-foreground">Output Pattern</label>
        <input
          type="text"
          value={outputPattern}
          onChange={(event) => onOutputChange(event.target.value)}
          className="w-full rounded border border-border bg-muted/40 px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
          placeholder="e.g. case_*.out"
        />
        <p className="mt-1 text-xs text-muted-foreground">Must capture the same number as the input pattern so files pair up.</p>
        {outputError && <p className="mt-1 text-xs text-destructive">{outputError}</p>}
      </div>
      <div className="flex flex-col items-end gap-1 pb-0.5">
        <button onClick={onBackToMethod} className="text-xs text-muted-foreground underline hover:text-foreground">Change Method</button>
        {pastedNotice && <span className="text-xs text-info">Pasted — lint skipped.</span>}
      </div>
    </div>
  );
}
