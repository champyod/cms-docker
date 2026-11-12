import type { Prisma } from '@prisma/client';

import { PATCHING_SEVERITIES, PATCHING_SOURCES, type PatchingQuery } from '@/lib/security/patching';
import type { ScanScope, WaiverRow } from '@/lib/security/patching-read-types';
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

/** The filters as SQL: an absent filter is the absence of a clause, not a wildcard. */
export function filteredWhere(query: PatchingQuery): Prisma.security_findingsWhereInput {
  return unresolvedWhere({
    ...(query.source === 'all' ? {} : { source: query.source }),
    ...(query.severity === 'all' ? {} : { severity: query.severity }),
    // One stored verdict, so the count and the page select exactly the rows the badge names.
    ...(query.reachability === 'all' ? {} : { reachability: query.reachability }),
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

/** The filters one finished push scopes to, host-null rows included as the ingest resolves them. */
export function scanScopeFilters(scan: ScanScope): Prisma.security_findingsWhereInput[] {
  const filters: Prisma.security_findingsWhereInput[] = [{ source: scan.source }];
  if (scan.host !== null) filters.push({ OR: [{ host: scan.host }, { host: null }] });
  return filters;
}
