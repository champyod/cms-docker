'use client';

import React from 'react';
import { Input as AdapterInput } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

// Why the class is here and not the surface: the icon indent is field policy,
// the field styling itself comes from the adapter.
const ICON_INDENT = 'pl-10';

/**
 * The label is bound with `htmlFor`/`id` and the error with `aria-describedby`, not merely
 * coloured: a label that cannot focus its field and an error nobody announces exist on screen
 * and not for the reader using a screen reader.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, required, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-foreground ml-1">
            {label}
            {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {icon}
            </div>
          )}
          <AdapterInput
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(icon && ICON_INDENT, className)}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="text-xs text-destructive ml-1">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
