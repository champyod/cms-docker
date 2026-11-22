'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { fieldClasses } from '@/components/core/fieldStyles';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  options: readonly SelectOption[];
  /** Rendered as a disabled first option so "nothing chosen" is visible rather than silent. */
  placeholder?: string;
}

/**
 * A native `<select>` on purpose. The browser already gives keyboard navigation, type-ahead,
 * platform pickers on touch and a screen-reader announcement that a hand-built listbox has to
 * re-earn in every browser; no option here needs rich markup.
 * The error is linked with `aria-describedby`, not only coloured.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, id, required, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-foreground ml-1">
            {label}
            {required && (
              <span className="text-destructive ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(fieldClasses(Boolean(error)), 'appearance-none pr-9', className)}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {error && (
          <p id={errorId} className="text-xs text-destructive ml-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
