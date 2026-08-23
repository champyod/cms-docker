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
              "w-full px-4 py-3 bg-black/40 border rounded-xl text-white",
              value === null ? 'opacity-50' : '',
              hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-white/5 focus:ring-indigo-500/50'
            )}
            placeholder="Unlimited"
        />
        <button
            type="button"
            onClick={() => onChangeValue(value === null ? 0 : null)}
            className={`px-3 rounded-xl border border-white/10 flex items-center gap-2 ${value === null ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50' : 'bg-black/20 text-neutral-400 hover:text-white'}`}
            title="Toggle Unlimited"
        >
            <span className="text-xs font-bold">∞</span>
        </button>
    </div>
  );
}
