'use client';

import Link from 'next/link';

import { Button } from '@/components/core/Button';

export interface RecordListPagerProps {
  readonly currentPage: number;
  readonly totalPages: number;
  /** Used by a list that pages in memory; `hrefForPage` takes over when the server pages. */
  readonly onPageChange?: (page: number) => void;
  /**
   * Where a page lives, when the page number is part of the request.
   *
   * WHY a link and not a callback: a server-paged list reads the page number from the URL, so the
   * pager's job is to produce that URL. A real anchor is shareable, opens in a new tab and works
   * before hydration; a list that pages in memory leaves this undefined and keeps its button.
   */
  readonly hrefForPage?: (page: number) => string;
  /**
   * How many rows the SERVER counted, shown beside the page number.
   *
   * WHY the total and not the length of the page: "Page 3 of 138" says nothing about whether the
   * filter is narrowing anything, and every full page has the same length.
   */
  readonly totalRows?: number;
  /** What one of those rows is called, singular ("finding"). */
  readonly rowLabel?: string;
}

// Why page changes stay in the query string: the list page reads it on the
// server, so a reload, a shared link, and the pager all resolve the same page.
export function RecordListPager({
  currentPage,
  totalPages,
  onPageChange,
  hrefForPage,
  totalRows,
  rowLabel,
}: RecordListPagerProps): React.JSX.Element {
  const atFirstPage = currentPage <= 1;
  const atLastPage = currentPage >= totalPages;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {hrefForPage !== undefined && !atFirstPage ? (
        <Link
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm underline-offset-4 hover:underline"
          href={hrefForPage(currentPage - 1)}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={atFirstPage || hrefForPage !== undefined}
          onClick={onPageChange === undefined ? undefined : () => onPageChange(currentPage - 1)}
        >
          Previous
        </Button>
      )}
      <div className="flex items-center px-4 text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
        {totalRows !== undefined && (
          <span className="ml-2 font-mono">
            {totalRows} {rowLabel ?? 'rows'}
          </span>
        )}
      </div>
      {hrefForPage !== undefined && !atLastPage ? (
        <Link
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm underline-offset-4 hover:underline"
          href={hrefForPage(currentPage + 1)}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={atLastPage || hrefForPage !== undefined}
          onClick={onPageChange === undefined ? undefined : () => onPageChange(currentPage + 1)}
        >
          Next
        </Button>
      )}
    </div>
  );
}
