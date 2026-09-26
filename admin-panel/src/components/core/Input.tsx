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

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, ...props }, ref) => {
    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label className="text-sm font-medium text-foreground ml-1">
            {label}
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
            aria-invalid={error ? true : undefined}
            className={cn(icon && ICON_INDENT, className)}
            {...props}
          />
        </div>
        {error && (
          <p className="text-xs text-destructive ml-1">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
