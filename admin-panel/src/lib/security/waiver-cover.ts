import type { Prisma, security_waivers } from '@prisma/client';

/**
 * The rows a waiver can reach, as SQL.
 *
 * WHY this lives in its own module: three callers now need the same predicate — the page's
 * "untouched" filter, the digest's waived set, and the scan announcement's waived count — and a
 * second copy of it is how they would start counting different rows. It only NARROWS the candidate
 * set; every row returned still gets its verdict from `waiverStateFor`, exactly like `waiverCovers`.
 *
 * WHY it is `null` and not `{}` for no waivers: "no waiver covers anything" and "every row is
 * covered" are opposite answers, and an empty `OR` would mean the latter.
 */
export function waiverCoverWhere(
  waivers: readonly Pick<security_waivers, 'source' | 'match'>[],
): Prisma.security_findingsWhereInput | null {
  const clauses = waivers.map((waiver) => ({
    source: waiver.source,
    OR: [
      { key: waiver.match },
      { key: { contains: waiver.match } },
      { title: { contains: waiver.match } },
    ],
  }));
  return clauses.length === 0 ? null : { OR: clauses };
}
