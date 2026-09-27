'use client';

import { useEffect, useMemo } from 'react';

import { useListSession } from '@/hooks/useListSession';
import type { UsersPageRow } from '@/lib/prisma-selects';

const USERS_LIST_ROUTE_ID = 'people.users';

export interface UserSelection {
  readonly selectedIds: Set<number>;
  readonly selectedUsers: UsersPageRow[];
  readonly toggleAll: (checked: boolean) => void;
  readonly toggleOne: (userId: number, checked: boolean) => void;
}

// Why the cache lookup: the visible page can change between selecting a row and
// running a bulk action, so a selected row is resolved by id, never by position.
//
// Why the session and not local state: opening a user record and coming back used
// to cost the reader every checked box, and the list behind a record tab is the
// one place that still has the rows to act on them.
export function useUserSelection(
  users: readonly UsersPageRow[],
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

  const toggleAll = (checked: boolean): void => {
    users.forEach((user) => session.setSelected(String(user.id), checked));
  };

  const toggleOne = (userId: number, checked: boolean): void => {
    session.setSelected(String(userId), checked);
  };

  const selectedUsers = useMemo(
    () => [...session.selectedIds].map((id) => userCache[Number(id)]).filter(Boolean),
    [session.selectedIds, userCache],
  );

  return { selectedIds, selectedUsers, toggleAll, toggleOne };
}
