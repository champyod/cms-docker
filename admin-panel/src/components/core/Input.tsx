'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, ...props }, ref) => {
    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label className="text-sm font-medium text-slate-300 ml-1">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              "glass-input w-full",
              icon && "pl-10",
              error && "border-red-500/50 focus:ring-red-500/50",
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p className="text-xs text-red-400 ml-1">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
