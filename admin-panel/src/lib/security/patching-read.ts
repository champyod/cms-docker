import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  buildPatchingCards, clampPatchingPage, groupFindings, PATCHING_PAGE_SIZE, PATCHING_SEVERITIES,
  patchingPageCount, readPatchingQuery, type PatchingFinding, type PatchingFindingCounts,
  type PatchingListState, type PatchingQuery, type PatchingQueryInput, type PatchingWaiver,
} from '@/lib/security/patching';
import {
  mapPatchingFinding, mapPatchingFindings, mapPatchingWaiver, toWaiverRecord, waiverOwners,
} from '@/lib/security/patching-read-rows';
import { tallyFeedTotals, tallyFindingCounts, type FeedTotals } from '@/lib/security/patching-read-totals';
import type {
  BulkWaiveFeed, FindingRow, PatchingSnapshot, ScanScope, WaiverRow,
} from '@/lib/security/patching-read-types';
import {
  filteredWhere, pageOrderBy, scanScopeFilters, unresolvedWhere, unratedWhere, untouchedWhere,
} from '@/lib/security/patching-read-where';
import { SCAN_CRITICAL_LINES, type ScanCriticalRow, type ScanRunFacts } from '@/lib/security/scan-report';
import { agedCutoff, buildSecurityDigest, SIGNAL_RULES, type PatchingSignalFacts } from '@/lib/security/signal';
import { readStalenessSnapshotCached } from '@/lib/security/staleness';
import { waiverCoverWhere } from '@/lib/security/waiver-cover';
import { WAIVER_EXPORT_VERSION, type WaiverExport } from '@/lib/security/waiver-gate';

export { mapPatchingFinding } from '@/lib/security/patching-read-rows';
export type {
  BulkWaiveCandidate, BulkWaiveFeed, BulkWaiveWaiver, PatchingSnapshot, ScanScope,
} from '@/lib/security/patching-read-types';

// The one read path: the only module that queries security_findings or security_waivers.

/** The live waivers: the decisions that currently suppress something, soonest review date first. */
function liveWaiverRows(): Promise<WaiverRow[]> {
  return prisma.security_waivers.findMany({ where: { ended_at: null }, orderBy: [{ review_by: 'asc' }] });
}

/** The two aggregates the four cards need: unresolved rows per family, and rootfs rows with a fix. */
async function readFindingCounts(): Promise<PatchingFindingCounts> {
  const [bySourceRows, rootfsWithAvailable] = await Promise.all([
    prisma.security_findings.groupBy({ by: ['source'], where: unresolvedWhere(), _count: { _all: true } }),
    prisma.security_findings.count({ where: unresolvedWhere({ source: 'rootfs', available: { not: null } }) }),
  ]);
  return tallyFindingCounts(bySourceRows, rootfsWithAvailable);
}

/** The page of rows for a query, or none when the filter matched nothing. */
async function readPageRows(query: PatchingQuery, total: number): Promise<FindingRow[]> {
  if (total === 0) return [];
  return prisma.security_findings.findMany({
    where: filteredWhere(query),
    orderBy: pageOrderBy(query),
    skip: (query.page - 1) * PATCHING_PAGE_SIZE,
    take: PATCHING_PAGE_SIZE,
  });
}

/** One page of rows plus the numbers describing the whole set. */
export async function readPatchingPage(
  input: PatchingQueryInput = {}, now: Date = new Date(),
): Promise<PatchingListState> {
  const requested = readPatchingQuery(input);
  const [waivers, counts, total] = await Promise.all([
    liveWaiverRows(),
    readFindingCounts(),
    prisma.security_findings.count({ where: filteredWhere(requested) }),
  ]);
  // Clamped after the count: `?page=999` on a shrunken feed must not render an empty table.
  const query: PatchingQuery = { ...requested, page: clampPatchingPage(requested.page, total) };
  const rows = await readPageRows(query, total);
  const owners = await waiverOwners(waivers);
  return {
    groups: groupFindings(mapPatchingFindings(rows, waivers, now)),
    waivers: waivers.map((row) => mapPatchingWaiver(row, owners, now)),
    cards: buildPatchingCards(counts, waivers, now),
    page: { query, pageSize: PATCHING_PAGE_SIZE, total, pageCount: patchingPageCount(total) },
  };
}

/** One `groupBy(source, severity)` answers both totals the digest needs. */
async function readFeedTotals(
  where: Prisma.security_findingsWhereInput = unresolvedWhere(),
): Promise<FeedTotals> {
  const rows = await prisma.security_findings.groupBy({
    by: ['source', 'severity'],
    where,
    _count: { _all: true },
  });
  return tallyFeedTotals(rows);
}

/** The most severe unresolved row, ties to the earliest sighting; an unrated row only wins alone. */
async function readWorstFinding(
  totals: FeedTotals, waivers: readonly WaiverRow[], now: Date,
): Promise<PatchingFinding | null> {
  const topSeverity = PATCHING_SEVERITIES.find((severity) => totals.bySeverity[severity] > 0);
  const where =
    topSeverity !== undefined
      ? unresolvedWhere({ severity: topSeverity })
      : totals.unrated > 0
        ? unratedWhere()
        : null;
  if (where === null) return null;
  const row = await prisma.security_findings.findFirst({
    where,
    orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
  });
  return row === null ? null : mapPatchingFinding(row, waivers, now);
}

/** Every row a live waiver touches, mapped: a bounded set, counted first so the fetch stays `take`-bound. */
async function readWaivedFindings(
  waivers: readonly WaiverRow[], now: Date, scope: readonly Prisma.security_findingsWhereInput[] = [],
): Promise<PatchingFinding[]> {
  const cover = waiverCoverWhere(waivers);
  if (cover === null) return [];
  const where = unresolvedWhere({ AND: [...scope, cover] });
  const total = await prisma.security_findings.count({ where });
  if (total === 0) return [];
  const rows = await prisma.security_findings.findMany({ where, orderBy: [{ id: 'asc' }], take: total });
  return mapPatchingFindings(rows, waivers, now);
}

/** The few rows a message can name: the oldest untouched row and the push-worthy ones (unwaived). */
async function readSignalRows(
  totals: FeedTotals, waivers: readonly WaiverRow[], now: Date,
): Promise<Pick<PatchingSignalFacts, 'criticals' | 'worst' | 'oldest'>> {
  const touched = untouchedWhere(waivers);
  const [worst, oldest, criticals] = await Promise.all([
    readWorstFinding(totals, waivers, now),
    prisma.security_findings
      .findFirst({ where: unresolvedWhere(touched), orderBy: [{ first_seen: 'asc' }, { id: 'asc' }] })
      .then((row) => (row === null ? null : mapPatchingFinding(row, waivers, now))),
    prisma.security_findings.findMany({
      // Push severities no waiver touches: a lapsed decision is reported as that decision instead.
      where: unresolvedWhere({ severity: { in: [...SIGNAL_RULES.pushSeverities] }, ...touched }),
      orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
      take: SIGNAL_RULES.maxLines,
    }),
  ]);
  return { worst, oldest, criticals: mapPatchingFindings(criticals, waivers, now) };
}

/** The facts the digest is built from: the totals first, then the aggregates and bounded rows. */
async function readSignalFacts(
  waivers: readonly WaiverRow[], mappedWaivers: readonly PatchingWaiver[],
  counts: PatchingFindingCounts, now: Date,
): Promise<PatchingSignalFacts> {
  const totals = await readFeedTotals();
  const [aged, waived, rows] = await Promise.all([
    prisma.security_findings.count({ where: unresolvedWhere({ first_seen: { lte: agedCutoff(now) } }) }),
    readWaivedFindings(waivers, now),
    readSignalRows(totals, waivers, now),
  ]);
  return {
    cards: buildPatchingCards(counts, waivers, now),
    waivers: mappedWaivers,
    bySource: totals.bySource,
    bySeverity: totals.bySeverity,
    unrated: totals.unrated,
    aged,
    waived,
    ...rows,
  };
}

/** The card numbers and the digest; the page reads its rows through {@link readPatchingPage}. */
export async function readPatchingSnapshot(now: Date = new Date()): Promise<PatchingSnapshot> {
  const [waivers, staleness] = await Promise.all([
    liveWaiverRows(),
    // The backup age is its own reading, not a finding: the digest joins the two.
    readStalenessSnapshotCached(),
  ]);
  const [counts, owners] = await Promise.all([readFindingCounts(), waiverOwners(waivers)]);
  const mappedWaivers = waivers.map((row) => mapPatchingWaiver(row, owners, now));
  const facts = await readSignalFacts(waivers, mappedWaivers, counts, now);
  return { waivers: mappedWaivers, cards: facts.cards, signal: buildSecurityDigest(facts, staleness, now) };
}

/** The waiver table as CI reads it, through the same rows and mapping the page shows. */
export async function readWaiverExport(now: Date = new Date()): Promise<WaiverExport> {
  const rows = await liveWaiverRows();
  const owners = await waiverOwners(rows);
  return {
    version: WAIVER_EXPORT_VERSION,
    generatedAt: now.toISOString(),
    waivers: rows.map((row) => toWaiverRecord(row, owners.get(row.created_by))),
  };
}

/** The rows a bulk waiver judges and the live decisions over them, source pinned by the caller. */
export async function readBulkWaiveFeed(source: string): Promise<BulkWaiveFeed> {
  const [rows, waivers] = await Promise.all([
    prisma.security_findings.findMany({
      where: { resolved_at: null, source },
      select: { id: true, key: true, title: true, host: true, reachability: true },
      orderBy: [{ id: 'asc' }],
    }),
    prisma.security_waivers.findMany({
      where: { ended_at: null },
      select: { source: true, match: true, ended_at: true },
    }),
  ]);
  return { rows, waivers };
}

/** The CRITICAL rows a message can name, oldest first, each with the verdict the page would give. */
async function readScanCriticals(
  scan: ScanScope, waivers: readonly WaiverRow[], now: Date,
): Promise<ScanCriticalRow[]> {
  const rows = await prisma.security_findings.findMany({
    where: unresolvedWhere({ AND: [...scanScopeFilters(scan), { severity: 'CRITICAL' }] }),
    orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
    take: SCAN_CRITICAL_LINES,
  });
  return mapPatchingFindings(rows, waivers, now).map((finding) => ({
    key: finding.key, subject: finding.subject, waiver: finding.waiver.status,
    reviewBy: finding.waiver.status === 'none' ? null : finding.waiver.reviewBy,
  }));
}

/** One completed run as its announcement reads it; every number is scoped to the push. */
export async function readCompletedScanFacts(scan: ScanScope, now: Date = new Date()): Promise<ScanRunFacts> {
  const waivers = await liveWaiverRows();
  const scope = unresolvedWhere({ AND: scanScopeFilters(scan) });
  const [totals, added, criticalRows, waivedRows] = await Promise.all([
    readFeedTotals(scope),
    prisma.security_findings.count({ where: { ...scope, first_seen: { gte: scan.runStartedAt } } }),
    readScanCriticals(scan, waivers, now),
    readWaivedFindings(waivers, now, scanScopeFilters(scan)),
  ]);
  return {
    source: scan.source,
    host: scan.host,
    runStartedAt: scan.runStartedAt,
    total: PATCHING_SEVERITIES.reduce((sum, severity) => sum + totals.bySeverity[severity], 0) + totals.unrated,
    added,
    criticals: totals.bySeverity.CRITICAL,
    counts: {
      high: totals.bySeverity.HIGH, medium: totals.bySeverity.MEDIUM,
      low: totals.bySeverity.LOW, unrated: totals.unrated,
    },
    waived: waivedRows.filter((finding) => finding.waiver.status === 'active').length,
    criticalRows,
  };
}
