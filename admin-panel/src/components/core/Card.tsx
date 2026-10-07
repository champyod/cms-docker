'use client';

import React from 'react';

import { EmptyState } from '@/components/core/EmptyState';
import { Card as AdapterCard } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  active?: boolean;
}

// Why these two classes and not the surface: padding and colour transition are
// product policy, the card surface itself comes from the adapter.
const CARD_PADDING = 'p-6 transition-colors';
const CARD_ACTIVE = 'border-ring ring-ring/20 ring-1';

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, children, active, ...props }, ref) => {
    const isEmpty = children === null || children === undefined;
    if (isEmpty) {
      return <EmptyState title="No content available" description="Card content is empty" />;
    }
    return (
      <AdapterCard
        ref={ref}
        className={cn(CARD_PADDING, active && CARD_ACTIVE, className)}
        {...props}
      >
        {children}
      </AdapterCard>
    );
  }
);

Card.displayName = "Card";
