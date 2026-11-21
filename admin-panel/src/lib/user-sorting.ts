import type { Prisma } from '@prisma/client';

import type { ListSort, ListSortInput } from './list-sorting';

export const USER_SORT_KEYS = [
  'name',
  'username',
  'email',
  'id',
  'status',
  'organization',
  'country',
  'contests',
] as const;

export type UserSortKey = (typeof USER_SORT_KEYS)[number];

export function isUserSortKey(value: string): value is UserSortKey {
  return (USER_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<UserSortKey, (direction: 'asc' | 'desc') => Prisma.usersOrderByWithRelationInput[]> = {
  name: (direction) => [{ first_name: direction }, { last_name: direction }],
  username: (direction) => [{ username: direction }],
  email: (direction) => [{ email: direction }],
  id: (direction) => [{ id: direction }],
  status: (direction) => [{ status: direction }],
  organization: (direction) => [{ organization: direction }],
  country: (direction) => [{ country: direction }],
  contests: (direction) => [{ participations: { _count: direction } }],
};

export function userSortOrderBy(sort: ListSortInput): Prisma.usersOrderByWithRelationInput[] {
  if (sort == null || !isUserSortKey(sort.key)) return [{ id: 'asc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}

export function toUserSort(sort: ListSort): ListSort {
  return { key: sort.key, direction: sort.direction };
}
