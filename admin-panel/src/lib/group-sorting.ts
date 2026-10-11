import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const GROUP_SORT_KEYS = [
  'name',
  'description',
  'is_seeded',
  'permissions',
] as const;

export type GroupSortKey = (typeof GROUP_SORT_KEYS)[number];

export function isGroupSortKey(value: string): value is GroupSortKey {
  return (GROUP_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<GroupSortKey, (direction: 'asc' | 'desc') => Prisma.groupsOrderByWithRelationInput[]> = {
  name: (direction) => [{ name: direction }],
  description: (direction) => [{ description: direction }],
  is_seeded: (direction) => [{ is_seeded: direction }],
  permissions: (direction) => [{ group_permissions: { _count: direction } }],
};

export function groupSortOrderBy(sort: ListSortInput): Prisma.groupsOrderByWithRelationInput[] {
  if (sort == null || !isGroupSortKey(sort.key)) return [{ name: 'asc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
