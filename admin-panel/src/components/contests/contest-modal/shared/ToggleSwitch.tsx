'use client';

import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
  checked: boolean;
  onToggle: () => void;
}

export function ToggleSwitch({ checked, onToggle }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0'
      )}
    >
      <div
        className={cn(
          'relative h-6 w-12 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted'
        )}
      >
        <div
          className={cn(
            'absolute top-1 size-4 rounded-full bg-background transition-all',
            checked ? 'left-7' : 'left-1'
          )}
        />
      </div>
    </button>
  );
}
