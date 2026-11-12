import type { Prisma } from '@prisma/client';

import { PATCHING_SEVERITIES, PATCHING_SOURCES, type PatchingQuery } from '@/lib/security/patching';
import type { WaiverRow } from '@/lib/security/patching-read-types';
import { flippedUnderWaiverWhere } from '@/lib/security/verdict-flip';
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

/** The flipped rows as SQL: the waiver predicate widened by "reachable now" and an open flip. */
export function flippedRowsWhere(waivers: readonly WaiverRow[]): Prisma.security_findingsWhereInput {
  const flipped = flippedUnderWaiverWhere(waivers);
  // WHY an impossible set and not `{}`: with no live waiver nothing is hidden by one, so this
  // filter selects nothing — the opposite of leaving the clause out.
  return flipped === null ? { id: { in: [] } } : flipped;
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
