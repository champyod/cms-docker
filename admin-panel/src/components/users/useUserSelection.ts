'use client';

import { useEffect, useMemo } from 'react';

import { useListSession } from '@/hooks/useListSession';
import type { UsersPageRow } from '@/lib/prisma-selects';

const USERS_LIST_ROUTE_ID = 'people.users';

export interface UserSelection {
  readonly selectedIds: Set<number>;
  readonly selectedUsers: UsersPageRow[];
  /** Selected ids that no already-read page could resolve, so no action can reach them. */
  readonly missingCount: number;
  readonly toggleOne: (userId: number, checked: boolean) => void;
  /** Selects or clears a set of ids at once, so select-all can cover a whole filter. */
  readonly setMany: (ids: readonly number[], checked: boolean) => void;
  readonly clear: () => void;
}

// Why the cache lookup: the visible page can change between selecting a row and
// running a bulk action, so a selected row is resolved by id, never by position.
//
// Why the session and not local state: opening a user record and coming back used
// to cost the reader every checked box, and the list behind a record tab is the
// one place that still has the rows to act on them.
/**
 * Why the count is surfaced: a selection survives paging, so an id whose row is gone
 * from every fetched page used to drop out of the action silently. The reader sees
 * how many cannot be reached instead of a shrinking selection with no explanation.
 */
export function countUnreachableSelection(selectedIdCount: number, resolvedCount: number): number {
  return Math.max(selectedIdCount - resolvedCount, 0);
}

export function useUserSelection(
  userCache: Readonly<Record<number, UsersPageRow>>,
): UserSelection {
  const session = useListSession(USERS_LIST_ROUTE_ID);
  const cachedIds = useMemo(() => Object.keys(userCache), [userCache]);

  // Why the cache and not the visible page: a bulk action spans the pages the
  // reader has already read, so a selection is only stale once its row is gone
  // from every page fetched so far.
  useEffect(() => {
    session.restore(cachedIds);
  }, [cachedIds, session]);

  const selectedIds = useMemo(
    () => new Set([...session.selectedIds].map((id) => Number(id))),
    [session.selectedIds],
  );

  const toggleOne = (userId: number, checked: boolean): void => {
    session.setSelected(String(userId), checked);
  };

  const selectedUsers = useMemo(
    () => [...session.selectedIds].map((id) => userCache[Number(id)]).filter(Boolean),
    [session.selectedIds, userCache],
  );

  const missingCount = countUnreachableSelection(selectedIds.size, selectedUsers.length);

  return {
    selectedIds,
    selectedUsers,
    missingCount,
    toggleOne,
    setMany: (ids, checked) => {
      ids.forEach((id) => session.setSelected(String(id), checked));
    },
    clear: () => session.clear(),
  };
}
