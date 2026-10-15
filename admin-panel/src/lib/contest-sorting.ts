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
  tasks: (direction) => [{ contest_tasks: { _count: direction } }],
  participants: (direction) => [{ participations: { _count: direction } }],
};

// Why the active contest leads the default order: the row is the one the stack is running on,
// so an unsorted list must open on it rather than on the lowest id.
const DEFAULT_ORDER_BY: Prisma.contestsOrderByWithRelationInput[] = [{ is_active: 'desc' }, { id: 'asc' }];

export function contestSortOrderBy(sort: ListSortInput): Prisma.contestsOrderByWithRelationInput[] {
  if (sort == null || !isContestSortKey(sort.key)) return DEFAULT_ORDER_BY;
  return ORDER_BY_KEY[sort.key](sort.direction);
}
