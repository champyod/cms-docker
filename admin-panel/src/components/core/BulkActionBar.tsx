'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/core/Button';
import { interpolate } from '@/lib/interpolate';

interface BulkActionBarProps {
  readonly selectedCount: number;
  /** A template carrying `{count}`; the bar owns the number so a list cannot print its own. */
  readonly countLabel: string;
  readonly clearLabel: string;
  readonly onClear: () => void;
  readonly children: ReactNode;
}

/**
 * The bar a selectable list shows once rows are checked. It owns the count and
 * the clear affordance, so a list only contributes its own actions.
 *
 * WHY the labels arrive as templates and not as literals: the count and the clear affordance are
 * the two strings every list would otherwise spell for itself, and a literal here would ship an
 * English-only bar under a Thai page. The list passes its dictionary's own strings.
 */
export function BulkActionBar({ selectedCount, countLabel, clearLabel, onClear, children }: BulkActionBarProps): React.JSX.Element | null {
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium text-foreground">{interpolate(countLabel, { count: selectedCount })}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" className="ml-auto" onClick={onClear}>{clearLabel}</Button>
    </div>
  );
}
