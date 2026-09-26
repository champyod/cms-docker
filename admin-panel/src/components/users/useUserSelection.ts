'use client';

import { useMemo, useState } from 'react';

import type { UsersPageRow } from '@/lib/prisma-selects';

export interface UserSelection {
  readonly selectedIds: Set<number>;
  readonly selectedUsers: UsersPageRow[];
  readonly toggleAll: (checked: boolean) => void;
  readonly toggleOne: (userId: number, checked: boolean) => void;
}

// Why the cache lookup: the visible page can change between selecting a row and
// running a bulk action, so a selected row is resolved by id, never by position.
export function useUserSelection(
  users: readonly UsersPageRow[],
  userCache: Readonly<Record<number, UsersPageRow>>,
): UserSelection {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleAll = (checked: boolean): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      users.forEach((user) => {
        if (checked) next.add(user.id);
        else next.delete(user.id);
      });
      return next;
    });
  };

  const toggleOne = (userId: number, checked: boolean): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const selectedUsers = useMemo(
    () => Array.from(selectedIds).map((id) => userCache[id]).filter(Boolean),
    [selectedIds, userCache],
  );

  return { selectedIds, selectedUsers, toggleAll, toggleOne };
}
