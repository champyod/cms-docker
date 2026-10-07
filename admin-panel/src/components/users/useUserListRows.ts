'use client';

import { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useAppRouter } from '@/hooks/useAppRouter';
import { useTable } from '@/hooks/useTable';
import { useTableAutoRefresh } from '@/hooks/useTableAutoRefresh';
import { apiClient, type ApiResponse } from '@/lib/apiClient';
import { writeListQuery, type ListQueryState } from '@/lib/list-state';
import type { UsersPageRow } from '@/lib/prisma-selects';

const AUTO_REFRESH_INTERVAL_MS = 60000;

type UserTableState = ReturnType<typeof useTable>;

export interface UserListQuery {
  readonly page?: number;
  readonly perPage?: number;
  readonly search?: string;
}

export interface UserListRows {
  readonly users: UsersPageRow[];
  readonly totalPages: number;
  readonly loading: boolean;
  readonly searchDraft: string;
  readonly setSearchDraft: (value: string) => void;
  readonly pageInput: string;
  readonly setPageInput: (value: string) => void;
  readonly table: UserTableState;
  // Why the cache: a refresh can drop a selected row from the visible page, and
  // a bulk action still needs its full row, so selections resolve by id.
  readonly userCache: Readonly<Record<number, UsersPageRow>>;
  readonly fetchUsers: (query?: UserListQuery) => Promise<void>;
}

export interface UserListRowsInput {
  readonly initialUsers: readonly UsersPageRow[];
  readonly totalPages: number;
  readonly currentPage: number;
  readonly perPage: number;
  readonly initialSearch: string;
}

interface UserPageRequest {
  page: number;
  perPage: number;
  search: string;
}

interface UserPageResponse {
  users?: UsersPageRow[];
  totalPages?: number;
  currentPage?: number;
  perPage?: number;
  search?: string;
}

function mergeIntoCache(previous: Record<number, UsersPageRow>, rows: readonly UsersPageRow[]): Record<number, UsersPageRow> {
  const next = { ...previous };
  rows.forEach((row) => { next[row.id] = row; });
  return next;
}

function resolveRequest(query: UserListQuery, table: UserTableState): UserPageRequest {
  return {
    page: Math.max(query.page ?? table.page, 1),
    perPage: query.perPage ?? table.perPage,
    search: query.search ?? table.search,
  };
}

// Why null, not a throw: a failed read leaves the current rows on screen, so the
// caller only has to skip the update instead of handling a second failure path.
async function requestUserPage(request: UserPageRequest): Promise<UserPageResponse | null> {
  const params = new URLSearchParams({
    page: String(request.page),
    perPage: String(request.perPage),
    search: request.search,
  });
  const result = (await apiClient.get(`/api/users?${params.toString()}`)) as ApiResponse & UserPageResponse;
  return result.success ? result : null;
}

export function useUserListRows({ initialUsers, totalPages, currentPage, perPage, initialSearch }: UserListRowsInput): UserListRows {
  const [users, setUsers] = useState<UsersPageRow[]>([...initialUsers]);
  const [userCache, setUserCache] = useState<Record<number, UsersPageRow>>(() => mergeIntoCache({}, initialUsers));
  const [totalPagesState, setTotalPagesState] = useState(totalPages);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const table = useTable({ initialPage: currentPage, initialPerPage: perPage, initialSearch });
  const router = useAppRouter();
  const pathname = usePathname() ?? '';

  // Why the URL is written here and not in the page: a page change arrives
  // through this fetch, and the canonical base path belongs to the route the
  // registry built, so only the query values are recomposed from state.
  const syncQueryToUrl = useCallback((state: ListQueryState): void => {
    router.replace(writeListQuery(pathname, state));
  }, [pathname, router]);

  const fetchUsers = useCallback(async (query: UserListQuery = {}) => {
    const isNavigation = Object.keys(query).length > 0;
    const request = resolveRequest(query, table);
    setLoading(true);
    try {
      const page = await requestUserPage(request);
      if (!page) return;
      // Why selection survives a refresh: the selected set lives outside the
      // fetched rows, so bulk actions and local previews stay visible.
      setUsers(page.users ?? []);
      setUserCache((previous) => mergeIntoCache(previous, page.users ?? []));
      setTotalPagesState(page.totalPages ?? 1);
      const nextPage = page.currentPage ?? request.page;
      const nextPerPage = page.perPage ?? request.perPage;
      const nextSearch = page.search ?? request.search;
      table.setPage(nextPage);
      table.setPerPage(nextPerPage);
      table.setSearch(nextSearch);
      setPageInput(String(nextPage));
      // Why only on navigation: the auto-refresh re-reads the page the reader is
      // already on, and pushing that same query would put an entry in history
      // every minute for a list nobody navigated.
      if (isNavigation) syncQueryToUrl({ page: nextPage, perPage: nextPerPage, search: nextSearch });
    } finally {
      setLoading(false);
    }
  }, [syncQueryToUrl, table]);

  useTableAutoRefresh({ enabled: true, intervalMs: AUTO_REFRESH_INTERVAL_MS, onRefresh: () => fetchUsers() });

  return {
    users, totalPages: totalPagesState, loading, searchDraft, setSearchDraft, pageInput, setPageInput,
    table, userCache, fetchUsers,
  };
}
