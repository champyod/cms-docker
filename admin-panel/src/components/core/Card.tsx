'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  active?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, active, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "glass-card p-6",
          active && "bg-white/10 border-white/20 ring-1 ring-white/10",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
