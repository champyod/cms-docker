'use client';

import { TablePaginationControls } from '@/components/core/TablePaginationControls';

import type { UserListRows } from './useUserListRows';

export interface UserListPaginationProps {
  readonly rows: UserListRows;
}

function clampPage(page: number, totalPages: number): number | null {
  if (!Number.isFinite(page)) return null;
  return Math.min(Math.max(page, 1), totalPages);
}

export function UserListPagination({ rows }: UserListPaginationProps): React.JSX.Element {
  const goToPage = (page: number): void => {
    // Why the null case: a half-typed page input is not a request, so an
    // unparsable value leaves the current page untouched.
    const target = clampPage(page, rows.totalPages);
    if (target === null) return;
    void rows.fetchUsers({ page: target });
  };
  return (
    <TablePaginationControls
      currentPage={rows.table.page}
      totalPages={rows.totalPages}
      pageInput={rows.pageInput}
      onPageInputChange={rows.setPageInput}
      onPageGo={() => goToPage(Number(rows.pageInput))}
      perPage={rows.table.perPage}
      onPerPageChange={(value) => { void rows.fetchUsers({ page: 1, perPage: value }); }}
      onPrev={() => goToPage(rows.table.page - 1)}
      onNext={() => goToPage(rows.table.page + 1)}
    />
  );
}
