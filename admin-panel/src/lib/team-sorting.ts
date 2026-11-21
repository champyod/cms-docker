import type { Prisma } from '@prisma/client';

import type { ListSortInput } from './list-sorting';

export const TEAM_SORT_KEYS = [
  'id',
  'code',
  'name',
  'members',
  'organization',
] as const;

export type TeamSortKey = (typeof TEAM_SORT_KEYS)[number];

export function isTeamSortKey(value: string): value is TeamSortKey {
  return (TEAM_SORT_KEYS as readonly string[]).includes(value);
}

const ORDER_BY_KEY: Record<TeamSortKey, (direction: 'asc' | 'desc') => Prisma.teamsOrderByWithRelationInput[]> = {
  id: (direction) => [{ id: direction }],
  code: (direction) => [{ code: direction }],
  name: (direction) => [{ name: direction }],
  members: (direction) => [{ participations: { _count: direction } }],
  organization: (direction) => [{ organization: direction }],
};

export function teamSortOrderBy(sort: ListSortInput): Prisma.teamsOrderByWithRelationInput[] {
  if (sort == null || !isTeamSortKey(sort.key)) return [{ name: 'asc' }];
  return ORDER_BY_KEY[sort.key](sort.direction);
}
