'use client';

import { Button } from '@/components/core/Button';

export interface RecordListPagerProps {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

// Why page changes stay in the query string: the list page reads it on the
// server, so a reload, a shared link, and the pager all resolve the same page.
export function RecordListPager({
  currentPage,
  totalPages,
  onPageChange,
}: RecordListPagerProps): React.JSX.Element {
  return (
    <div className="flex justify-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Previous
      </Button>
      <div className="flex items-center px-4 text-sm text-muted-foreground">
        Page {currentPage}
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
      </Button>
    </div>
  );
}
