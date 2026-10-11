import type { Prisma } from '@prisma/client';

import type { ListSort, ListSortInput } from './list-sorting';

export const ADMIN_SORT_KEYS = [
  'id',
  'username',
  'name',
  'last_login_at',
  'enabled',
] as const;

export type AdminSortKey = (typeof ADMIN_SORT_KEYS)[number];

export function isAdminSortKey(value: string): value is AdminSortKey {
  return (ADMIN_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<AdminSortKey, (direction: 'asc' | 'desc') => Prisma.adminsOrderByWithRelationInput[]> = {
  id: (direction) => [{ id: direction }],
  username: (direction) => [{ username: direction }],
  name: (direction) => [{ name: direction }],
  last_login_at: (direction) => [{ last_login_at: direction }],
  enabled: (direction) => [{ enabled: direction }],
};

export function adminSortOrderBy(sort: ListSortInput): Prisma.adminsOrderByWithRelationInput[] {
  if (sort == null || !isAdminSortKey(sort.key)) return [{ username: 'asc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}

export function toAdminSort(sort: ListSort): ListSort {
  return { key: sort.key, direction: sort.direction };
}
