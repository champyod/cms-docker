import { readActiveContestId } from '@/lib/active-contest';
import { prisma } from '@/lib/prisma';

/** One override as the orphan read needs it: the contest the row is filed under. */
export interface ScopedOverride {
  readonly contestId: number;
}

/**
 * The contest ids an enabled registry row binds.
 *
 * WHY enabled and named: cms.db.contest_binding reads the enabled rows that name a contest, so a
 * disabled row serves nothing and a row that names no contest serves every one — neither pins a
 * contest an override could be filed under.
 */
export async function readBoundContestIds(): Promise<Set<number>> {
  const rows = await prisma.services.findMany({
    where: { enabled: true, contest_id: { not: null } },
    select: { contest_id: true },
  });
  return new Set(rows.flatMap((row) => (row.contest_id === null ? [] : [row.contest_id])));
}

/**
 * The contests an override can actually reach.
 *
 * WHY the active contest is added when no row names one: a deployment with an empty registry still
 * serves contests.is_active (that is the same fallback cms.db.contest_binding takes), so treating
 * every override as an orphan there would flag rows that do apply.
 */
async function servedContestIds(): Promise<Set<number>> {
  const bound = await readBoundContestIds();
  if (bound.size > 0) return bound;
  const active = await readActiveContestId();
  return active === null ? bound : new Set([active]);
}

/**
 * The contest ids present in `overrides` that no binding serves.
 *
 * WHY an orphan is knowledge the panel alone holds: the ranking filters its rows by its own scope
 * (`WHERE active AND ($1::bigint IS NULL OR contest_id = $1)`), so a row under a contest it does
 * not serve stops applying with no error and no counter — only the panel reads both the registry
 * and the override rows, so only the panel can name that row.
 */
export async function readOrphanContestIds(
  overrides: readonly ScopedOverride[],
): Promise<Set<number>> {
  const served = await servedContestIds();
  return new Set(
    overrides.map((override) => override.contestId).filter((contestId) => !served.has(contestId)),
  );
}
