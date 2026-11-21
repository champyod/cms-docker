import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const AUDIT_SORT_KEYS = [
  'timestamp',
  'actor_id',
  'verb',
  'entity',
  'result',
] as const;

export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];

export function isAuditSortKey(value: string): value is AuditSortKey {
  return (AUDIT_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<AuditSortKey, (direction: 'asc' | 'desc') => Prisma.audit_logOrderByWithRelationInput[]> = {
  timestamp: (direction) => [{ timestamp: direction }],
  actor_id: (direction) => [{ actor_id: direction }],
  verb: (direction) => [{ verb: direction }],
  entity: (direction) => [{ entity: direction }],
  result: (direction) => [{ result: direction }],
};

export function auditSortOrderBy(sort: ListSortInput): Prisma.audit_logOrderByWithRelationInput[] {
  if (sort == null || !isAuditSortKey(sort.key)) return [{ id: 'desc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
