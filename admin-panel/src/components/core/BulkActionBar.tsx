'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/core/Button';

interface BulkActionBarProps {
  readonly selectedCount: number;
  readonly onClear: () => void;
  readonly children: ReactNode;
}

/**
 * The bar a selectable list shows once rows are checked. It owns the count and
 * the clear affordance, so a list only contributes its own actions.
 */
export function BulkActionBar({ selectedCount, onClear, children }: BulkActionBarProps): React.JSX.Element | null {
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" className="ml-auto" onClick={onClear}>Clear selection</Button>
    </div>
  );
}
