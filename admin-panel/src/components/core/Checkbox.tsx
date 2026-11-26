'use client';

import React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode;
  description?: string;
  error?: string;
}

/**
 * The target is the whole label row, not the 16px box: WCAG 2.5.8 asks for 24x24 and a bare
 * checkbox misses it even when the box looks big enough. The visual box is drawn from the
 * input itself so the checked state stays the browser's own — no second source of truth.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, error, id, required, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy = [description && `${inputId}-description`, error && `${inputId}-error`]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="space-y-1">
        <label
          htmlFor={inputId}
          className="flex min-h-6 cursor-pointer items-start gap-2 py-1 text-sm text-foreground"
        >
          <span className="relative mt-0.5 flex size-4 flex-none items-center justify-center">
            <input
              ref={ref}
              id={inputId}
              type="checkbox"
              required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy || undefined}
              className={cn(
                'peer size-4 appearance-none rounded-sm border border-input bg-transparent',
                'checked:border-primary checked:bg-primary',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
                error && 'border-destructive',
                className
              )}
              {...props}
            />
            <Check
              className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
              aria-hidden
            />
          </span>
          <span>
            {label}
            {required && (
              <span className="text-destructive ml-0.5" aria-hidden="true">
                *
              </span>
            )}
            {description && (
              <span id={`${inputId}-description`} className="block text-xs text-muted-foreground">
                {description}
              </span>
            )}
          </span>
        </label>
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-destructive ml-6">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
