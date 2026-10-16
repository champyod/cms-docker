import { prisma } from '@/lib/prisma';
import { isConfigTarget, SHOWN_KIND } from '@/lib/ranking-config';

/**
 * The board's config, read on the server.
 *
 * WHY this module rather than a read inside the surface's action: two callers need the same
 * fact — the config surface lists the shown targets, and `resyncRankingUsers` scopes its write
 * to them — so a `findMany` in each would be two spellings of one fact, which is the defect the
 * config surface exists to remove. The vocabulary (`ranking-config.ts`) stays Prisma-free so a
 * client component can import it; the read lives here, and both callers take it from here.
 */

/** One active config row, as the read returns it before a caller shapes it for its own use. */
export interface ActiveConfigRow {
  readonly id: bigint;
  readonly target_kind: string;
  readonly target_key: string;
  readonly reason: string | null;
  readonly created_at: Date;
  readonly created_by: number | null;
}

/**
 * Every active row of the board's config, newest first — the one read both callers share.
 *
 * WHY only the active rows: ending a target keeps its row so "who showed this and why" survives
 * the correction, so the live set is the answer to what the board shows now.
 */
export async function readActiveConfigRows(): Promise<ActiveConfigRow[]> {
  return prisma.ranking_config.findMany({
    where: { active: true },
    orderBy: { id: 'desc' },
    take: 200,
  });
}

/**
 * The contests the board shows, as the scope every read and write of the ranking must agree on.
 *
 * WHY a refusal rather than a skip: a `target_kind` this build does not draw or a key that is not
 * an id is a declaration the reader refuses at every route, so a caller that skipped it would
 * build a scope the board then refuses to match — the two halves of one fact disagreeing. Failing
 * here keeps them agreed, and a config the operator wrote is visible rather than silently dropped.
 */
export async function loadShownContestIds(): Promise<Set<number>> {
  const rows = await readActiveConfigRows();
  const shown = new Set<number>();
  for (const row of rows) {
    if (!isConfigTarget(row.target_kind)) {
      throw new Error(`ranking_config names a target kind the board cannot draw: ${row.target_kind}`);
    }
    if (row.target_kind !== SHOWN_KIND) continue;
    const key = row.target_key.trim();
    if (!/^\d+$/.test(key)) {
      throw new Error(`ranking_config shows ${JSON.stringify(row.target_key)}, which is not a contest id`);
    }
    shown.add(Number.parseInt(key, 10));
  }
  return shown;
}
