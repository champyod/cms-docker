import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const TASK_SORT_KEYS = [
  'id',
  'name',
  'title',
  'contests',
  'submissions',
] as const;

export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];

export function isTaskSortKey(value: string): value is TaskSortKey {
  return (TASK_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<TaskSortKey, (direction: 'asc' | 'desc') => Prisma.tasksOrderByWithRelationInput[]> = {
  id: (direction) => [{ id: direction }],
  name: (direction) => [{ name: direction }],
  title: (direction) => [{ title: direction }],
  contests: (direction) => [{ contests: { name: direction } }],
  submissions: (direction) => [{ submissions: { _count: direction } }],
};

export function taskSortOrderBy(sort: ListSortInput): Prisma.tasksOrderByWithRelationInput[] {
  if (sort == null || !isTaskSortKey(sort.key)) return [{ id: 'desc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
