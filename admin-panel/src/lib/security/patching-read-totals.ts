import {
  isPatchingSeverity,
  isPatchingSource,
  type PatchingFindingCounts,
  type PatchingSeverity,
  type PatchingSource,
} from '@/lib/security/patching';

/** One `groupBy(source)` row: the family and how many unresolved rows it holds. */
export interface SourceTallyRow {
  readonly source: string;
  readonly _count: { readonly _all: number };
}

/** One `groupBy(source, severity)` row: the same, split by the severity the contract ranks. */
export interface SeverityTallyRow extends SourceTallyRow {
  readonly severity: string | null;
}

/** Unresolved rows per producer family and per severity, with the unrated ones counted apart. */
export interface FeedTotals {
  readonly bySeverity: Record<PatchingSeverity, number>;
  readonly bySource: Record<PatchingSource, number>;
  readonly unrated: number;
  /** Unresolved HIGH rows carrying an `available` version: the ones a patch can actually close. */
  readonly highWithFix: number;
}

/** The per-family counts the four cards read; a family outside the enum is not counted into a card. */
export function tallyBySource(rows: readonly SourceTallyRow[]): Record<PatchingSource, number> {
  const bySource: Record<PatchingSource, number> = { diun: 0, rootfs: 0, osv: 0 };
  for (const row of rows) {
    if (isPatchingSource(row.source)) bySource[row.source] = row._count._all;
  }
  return bySource;
}

/** Both totals the digest needs, from the one `groupBy(source, severity)` the read path runs. */
export function tallyFeedTotals(rows: readonly SeverityTallyRow[]): FeedTotals {
  const bySeverity: Record<PatchingSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 0,
  };
  const bySource: Record<PatchingSource, number> = { diun: 0, rootfs: 0, osv: 0 };
  let unrated = 0;
  for (const row of rows) {
    if (!isPatchingSource(row.source)) continue;
    bySource[row.source] += row._count._all;
    if (isPatchingSeverity(row.severity)) bySeverity[row.severity] += row._count._all;
    else unrated += row._count._all;
  }
  return { bySeverity, bySource, unrated, highWithFix: 0 };
}

/** The card counts, formed from the aggregates SQL produced rather than from a row list. */
export function tallyFindingCounts(
  bySourceRows: readonly SourceTallyRow[],
  rootfsWithAvailable: number,
): PatchingFindingCounts {
  return { bySource: tallyBySource(bySourceRows), rootfsWithAvailable };
}
