import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const SUBMISSION_SORT_KEYS = [
  'id',
  'timestamp',
  'score',
] as const;

export type SubmissionSortKey = (typeof SUBMISSION_SORT_KEYS)[number];

export function isSubmissionSortKey(value: string): value is SubmissionSortKey {
  return (SUBMISSION_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<SubmissionSortKey, (direction: 'asc' | 'desc') => Prisma.submissionsOrderByWithRelationInput[]> = {
  id: (direction) => [{ id: direction }],
  timestamp: (direction) => [{ timestamp: direction }],
  score: (direction) => [{ submission_results: { _count: direction } }],
};

export function submissionSortOrderBy(sort: ListSortInput): Prisma.submissionsOrderByWithRelationInput[] {
  if (sort == null || !isSubmissionSortKey(sort.key)) return [{ timestamp: 'desc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
