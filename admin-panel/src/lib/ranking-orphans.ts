import { loadShownContestIds } from '@/lib/ranking-config-store';

/** One override as the orphan read needs it: the contest the row is filed under. */
export interface ScopedOverride {
  readonly contestId: number;
}

/**
 * The contest ids present in `overrides` that the board does not show.
 *
 * WHY the shown set and not the service registry: the ranker folds an override only inside the
 * contests the board draws, and `ranking_config` is the one table that decides them — the read the
 * config surface, the projection and `resyncRankingUsers` all take. A binding answers a different
 * question, which contest a process serves, so the two disagree in both directions: a bound
 * contest the operator took off the board went unflagged, and a shown contest no binding names was
 * flagged as an orphan. The badge therefore named the wrong rows, and named them confidently.
 *
 * WHY an orphan is knowledge the panel alone holds: the ranking filters its rows by that scope, so
 * an override filed under a contest the board does not show stops applying with no error and no
 * counter — only the panel reads both the config and the override rows, so only the panel can name
 * that row.
 */
export async function readOrphanContestIds(
  overrides: readonly ScopedOverride[],
): Promise<Set<number>> {
  const shown = await loadShownContestIds();
  return new Set(
    overrides.map((override) => override.contestId).filter((contestId) => !shown.has(contestId)),
  );
}
