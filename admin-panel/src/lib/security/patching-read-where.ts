import type { Prisma } from '@prisma/client';

import { PATCHING_SEVERITIES, PATCHING_SOURCES, type PatchingQuery } from '@/lib/security/patching';
import type { WaiverRow } from '@/lib/security/patching-read-types';
import { waiverCoverWhere } from '@/lib/security/waiver-cover';

/** Unresolved rows the contract can place: ingest resolves instead of deleting, so history survives. */
export function unresolvedWhere(
  extra: Prisma.security_findingsWhereInput = {},
): Prisma.security_findingsWhereInput {
  return { resolved_at: null, source: { in: [...PATCHING_SOURCES] }, ...extra };
}

/** The rows carrying no severity the contract knows — Diun's drift reports none. */
export function unratedWhere(
  extra: Prisma.security_findingsWhereInput = {},
): Prisma.security_findingsWhereInput {
  return unresolvedWhere({
    OR: [{ severity: null }, { severity: { notIn: [...PATCHING_SEVERITIES] } }],
    ...extra,
  });
}

/** Rows no live waiver touches: exactly the rows `waiverStateFor` reports as `none`. */
export function untouchedWhere(waivers: readonly WaiverRow[]): Prisma.security_findingsWhereInput {
  const cover = waiverCoverWhere(waivers);
  return cover === null ? {} : { NOT: cover };
}

/**
 * The flipped rows as SQL: a live waiver covers them, their stored verdict is 'reachable' now, and
 * the episode is still open.
 *
 * WHY `resolved_at: null` is in here: a resolved row is not reachable in any sense a reader acts
 * on, and the count must stop the moment it resolves even if the clearing write never ran (an
 * operator can resolve a feed, a restore can bring a row back). The stored fact says what happened;
 * this clause says whether it still holds.
 *
 * WHY an impossible set and not `{}` with no live waiver: "no waiver covers anything" means no row
 * can be hidden by one — an empty set, not an unrestricted one.
 */
export function flippedRowsWhere(waivers: readonly WaiverRow[]): Prisma.security_findingsWhereInput {
  const cover = waiverCoverWhere(waivers);
  if (cover === null) return { id: { in: [] } };
  return {
    AND: [cover, { reachability: 'reachable' }, { resolved_at: null }, { flip: { is: { cleared_at: null } } }],
  };
}

/** The filters as SQL: an absent filter is the absence of a clause, not a wildcard. */
export function filteredWhere(
  query: PatchingQuery,
  waivers: readonly WaiverRow[],
): Prisma.security_findingsWhereInput {
  return unresolvedWhere({
    ...(query.source === 'all' ? {} : { source: query.source }),
    ...(query.severity === 'all' ? {} : { severity: query.severity }),
    // One stored verdict, so the count and the page select exactly the rows the badge names.
    ...(query.reachability === 'all' ? {} : { reachability: query.reachability }),
    ...(query.flip === 'all' ? {} : flippedRowsWhere(waivers)),
  });
}

/** The primary sort key of a page: a real column, so `skip`/`take` order the same way. */
function primaryOrderBy(query: PatchingQuery): Prisma.security_findingsOrderByWithRelationInput {
  switch (query.sort) {
    case 'firstSeen':
      return { first_seen: query.direction };
    case 'subject':
      return { subject: query.direction };
    case 'host':
      return { host: query.direction };
    case 'source':
      return { source: query.direction };
    default:
      return { last_seen: query.direction };
  }
}

/** The ORDER BY for one page, with `id` as the tie-break two rows with the same date need. */
export function pageOrderBy(
  query: PatchingQuery,
): Prisma.security_findingsOrderByWithRelationInput[] {
  return [primaryOrderBy(query), { id: 'asc' }];
}

/** The rows one run speaks for: the box's own rows, or the un-hosted ones when no box was named. */
export function runScopeWhere(host: string | null): Prisma.security_findingsWhereInput {
  return unresolvedWhere({ host });
}
