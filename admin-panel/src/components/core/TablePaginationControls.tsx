'use client';

import { Button } from '@/components/core/Button';

interface TablePaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageGo: () => void;
  perPage: number;
  onPerPageChange: (value: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

export function TablePaginationControls({
  currentPage,
  totalPages,
  pageInput,
  onPageInputChange,
  onPageGo,
  perPage,
  onPerPageChange,
  onPrev,
  onNext,
}: TablePaginationControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-neutral-300">
      <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={onPrev}>
        {'<-'}
      </Button>
      <span>{currentPage}/{totalPages}</span>
      <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={onNext}>
        {'->'}
      </Button>

      <span className="ml-2 text-muted-foreground">page</span>
      <input
        type="number"
        min={1}
        max={totalPages}
        value={pageInput}
        title="Page number"
        placeholder="Page"
        onChange={(event) => onPageInputChange(event.target.value)}
        className="w-20 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      />
      <Button variant="ghost" size="sm" onClick={onPageGo}>Go</Button>

      <span className="ml-2 text-muted-foreground">per page</span>
      <select
        value={perPage}
        title="Rows per page"
        onChange={(event) => onPerPageChange(Number(event.target.value) || 20)}
        className="rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      >
        {[10, 20, 50, 100].map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
    </div>
  );
}
