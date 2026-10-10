'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { ariaSortFor, toggleListSort, type ListSortInput } from '@/lib/list-sorting';
import { cn } from '@/lib/utils';

export interface SortableHeaderProps {
  readonly label: string;
  readonly sortKey: string;
  readonly sort: ListSortInput;
  readonly onSortChange: (next: ListSortInput) => void;
  readonly className?: string;
}

export function SortableHeader({ label, sortKey, sort, onSortChange, className }: SortableHeaderProps): React.JSX.Element {
  const active = sort != null && sort.key === sortKey;
  const ariaSort = ariaSortFor(sort, sortKey);
  const Icon = active ? (sort?.direction === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <button
      type="button"
      aria-sort={ariaSort}
      onClick={() => onSortChange(toggleListSort(sort, sortKey))}
      className={cn(
        'group -mx-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        active && 'text-foreground',
        className,
      )}
    >
      {label}
      <Icon className={cn('size-3.5 shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} aria-hidden />
    </button>
  );
}
