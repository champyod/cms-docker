'use client';

import { cn } from '@/lib/utils';

interface UnlimitedNumberInputProps {
  value: number | null;
  onChangeValue: (value: number | null) => void;
  hasError: boolean;
}

export function UnlimitedNumberInput({ value, onChangeValue, hasError }: UnlimitedNumberInputProps) {
  return (
    <div className="flex gap-2">
      <input
        type="number"
        disabled={value === null}
        value={value ?? ''}
        onChange={(e) => onChangeValue(parseInt(e.target.value) || 0)}
        className={cn(
          'h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
          'placeholder:text-muted-foreground',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          hasError && 'border-destructive focus-visible:ring-destructive/20'
        )}
        placeholder="Unlimited"
      />
      <button
        type="button"
        onClick={() => onChangeValue(value === null ? 0 : null)}
        className={cn(
          'flex h-10 items-center gap-2 rounded-md border px-3 transition-colors',
          value === null
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-input bg-muted/30 text-muted-foreground hover:text-foreground'
        )}
        title="Toggle Unlimited"
        aria-pressed={value === null}
      >
        <span className="text-xs font-bold">∞</span>
      </button>
    </div>
  );
}
