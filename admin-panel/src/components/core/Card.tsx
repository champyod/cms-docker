'use client';

import React from 'react';

import { EmptyState } from '@/components/core/EmptyState';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  active?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, active, ...props }, ref) => {
    const isEmpty = children === null || children === undefined;
    if (isEmpty) {
      return <EmptyState title="No content available" description="Card content is empty" />;
    }
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border bg-card text-card-foreground shadow-sm p-6 transition-colors",
          active && "border-ring ring-ring/20 ring-1",
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
