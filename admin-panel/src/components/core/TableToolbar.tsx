'use client';

import { ReactNode } from 'react';
import { Button } from '@/components/core/Button';

interface TableToolbarProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchPlaceholder?: string;
  rightContent?: ReactNode;
}

export function TableToolbar({
  searchText,
  onSearchTextChange,
  onSearchSubmit,
  searchPlaceholder = 'Search...',
  rightContent,
}: TableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          placeholder={searchPlaceholder}
          title="Search"
          className="w-72 max-w-[60vw] rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
        <Button variant="ghost" type="button" onClick={onSearchSubmit}>Search</Button>
      </div>

      {rightContent}
    </div>
  );
}
