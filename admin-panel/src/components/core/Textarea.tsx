'use client';

import React from 'react';

import { cn } from '@/lib/utils';
import { fieldClasses } from '@/components/core/fieldStyles';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

/**
 * Resizes vertically only: a textarea that can grow sideways breaks every grid it sits in, and
 * one that grows without limit turns a dialog into a scrolling page. `rows` is the contract.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, required, rows = 3, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    const describedBy = [hint && `${textareaId}-hint`, error && `${textareaId}-error`]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-foreground ml-1">
            {label}
            {required && (
              <span className="text-destructive ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(fieldClasses(Boolean(error)), 'resize-y min-h-16', className)}
          {...props}
        />
        {hint && !error && (
          <p id={`${textareaId}-hint`} className="text-xs text-muted-foreground ml-1">
            {hint}
          </p>
        )}
        {error && (
          <p id={`${textareaId}-error`} className="text-xs text-destructive ml-1">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
