import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const CONTEST_SORT_KEYS = [
  'id',
  'name',
  'is_active',
  'start',
  'stop',
  'tasks',
  'participants',
] as const;

export type ContestSortKey = (typeof CONTEST_SORT_KEYS)[number];

export function isContestSortKey(value: string): value is ContestSortKey {
  return (CONTEST_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<ContestSortKey, (direction: 'asc' | 'desc') => Prisma.contestsOrderByWithRelationInput[]> = {
  id: (direction) => [{ id: direction }],
  name: (direction) => [{ name: direction }],
  is_active: (direction) => [{ is_active: direction }],
  start: (direction) => [{ start: direction }],
  stop: (direction) => [{ stop: direction }],
  tasks: (direction) => [{ tasks: { _count: direction } }],
  participants: (direction) => [{ participations: { _count: direction } }],
};

export function contestSortOrderBy(sort: ListSortInput): Prisma.contestsOrderByWithRelationInput[] {
  if (sort == null || !isContestSortKey(sort.key)) return [{ id: 'asc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
