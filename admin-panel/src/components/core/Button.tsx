'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const variants = {
      primary: "bg-indigo-600/80 hover:bg-indigo-600 border-indigo-500/50 text-white shadow-lg shadow-indigo-500/20 active:scale-95",
      secondary: "bg-white/10 hover:bg-white/20 border-white/10 text-white active:scale-95",
      ghost: "hover:bg-white/5 text-slate-300 hover:text-white border-transparent",
      danger: "bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-400 hover:text-red-300",
    };

    const sizes = {
      sm: "h-8 px-3 text-sm rounded-lg",
      md: "h-10 px-4 py-2 rounded-xl",
      lg: "h-12 px-6 text-lg rounded-2xl",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "glass-button inline-flex items-center justify-center gap-2 transition-all duration-200",
          variants[variant],
          sizes[size],
          disabled && "opacity-50 cursor-not-allowed active:scale-100",
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
