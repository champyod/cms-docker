import type { Prisma, security_findings, security_waivers } from '@prisma/client';

import { loadActorNames } from '@/lib/admin-names';
import { prisma } from '@/lib/prisma';
import {
  buildPatchingCards,
  clampPatchingPage,
  groupFindings,
  isPatchingSeverity,
  isPatchingSource,
  isWaiverExpired,
  PATCHING_PAGE_SIZE,
  PATCHING_SEVERITIES,
  PATCHING_SOURCES,
  patchingPageCount,
  readPatchingQuery,
  waiverStateFor,
  type PatchingCards,
  type PatchingFinding,
  type PatchingFindingCounts,
  type PatchingListState,
  type PatchingQuery,
  type PatchingQueryInput,
  type PatchingSource,
  type PatchingSeverity,
  type PatchingWaiver,
} from '@/lib/security/patching';
import {
  agedCutoff,
  buildSecurityDigest,
  SIGNAL_RULES,
  type PatchingSignalFacts,
  type SecurityDigest,
} from '@/lib/security/signal';
import { isReachability, type Reachability } from '@/lib/security/kernel-reachability';
import { readStalenessSnapshotCached } from '@/lib/security/staleness';
import { SCAN_CRITICAL_LINES, type ScanCriticalRow, type ScanRunFacts } from '@/lib/security/scan-report';
import { waiverCoverWhere } from '@/lib/security/waiver-cover';
import {
  WAIVER_EXPORT_VERSION,
  type WaiverExport,
  type WaiverRecord,
} from '@/lib/security/waiver-gate';

/**
 * The one read path for the security feed.
 *
 * WHY one module: the patching page, the overview cards and the signal job all answer questions
 * about the same two tables, and a second query beside this one would let them disagree about what
 * "unresolved" or "expired" means. The server action gates; this reads.
 *
 * WHY unresolved is `resolved_at: null` and not a delete: the ingest route resolves rows a
 * complete push no longer mentions, so the unresolved set is exactly what the producers reported
 * most recently. History stays in the table for the audit trail.
 *
 * WHY the table is paged in SQL and the cards are counted in SQL: a live host reports tens of
 * thousands of unresolved findings, and reading all of them to render twenty-five of them — or to
 * add up four numbers — made one page render a full-table read in JavaScript. Every query below is
 * therefore either an aggregate or bounded by `take`. The row→`PatchingFinding` mapping still exists
 * exactly once ({@link mapPatchingFinding}) so the page, the digest and the tests cannot start
 * describing the same row differently.
 *
 * WHY the waiver export is rendered here too: the file CI reads has to mean exactly what the page
 * shows, so it comes from the same rows through the same mapping rather than from a query beside
 * this one (docs/SECURITY-FEED.md §"Suppressions in CI").
 */

type FindingRow = security_findings;
type WaiverRow = security_waivers;

// A stored value outside the three verdicts is unjudged, never a guess — and never a safe answer.
function storedReachability(value: string): Reachability {
  return isReachability(value) ? value : 'unknown';
}

/**
 * The unresolved rows the contract can place.
 *
 * WHY the source is pinned in SQL: a row written by a future producer is not one of the three groups
 * the page claims to be complete about, so it must not be counted into a card either. The mapper
 * refuses such a row as well — the filter is what keeps the aggregate honest, and the mapper is what
 * keeps a single row honest.
 */
function unresolvedWhere(
  extra: Prisma.security_findingsWhereInput = {},
): Prisma.security_findingsWhereInput {
  return { resolved_at: null, source: { in: [...PATCHING_SOURCES] }, ...extra };
}

/** The rows carrying no severity the contract knows — Diun's drift reports none. */
function unratedWhere(
  extra: Prisma.security_findingsWhereInput = {},
): Prisma.security_findingsWhereInput {
  return unresolvedWhere({
    OR: [{ severity: null }, { severity: { notIn: [...PATCHING_SEVERITIES] } }],
    ...extra,
  });
}

/**
 * Rows no live waiver touches at all: exactly the rows `waiverStateFor` reports as `none`.
 *
 * WHY the predicate itself lives in `waiver-cover.ts`: the scan announcement counts waived rows with
 * it too, and a second copy of the three branches `waiverCovers` implements is how two surfaces
 * would start disagreeing about which rows a decision covers.
 */
function untouchedWhere(waivers: readonly WaiverRow[]): Prisma.security_findingsWhereInput {
  const cover = waiverCoverWhere(waivers);
  return cover === null ? {} : { NOT: cover };
}

/**
 * The ORDER BY for one page.
 *
 * WHY every sort key is a real column: the ordering has to happen in the database for `skip`/`take`
 * to mean anything.
 */
function pageOrderBy(query: PatchingQuery): Prisma.security_findingsOrderByWithRelationInput[] {
  const primary: Prisma.security_findingsOrderByWithRelationInput =
    query.sort === 'firstSeen'
      ? { first_seen: query.direction }
      : query.sort === 'subject'
        ? { subject: query.direction }
        : query.sort === 'host'
          ? { host: query.direction }
          : query.sort === 'source'
            ? { source: query.direction }
            : { last_seen: query.direction };
  // WHY `id` as well: without a unique tie-break two rows with the same date can swap order between
  // pages, which shows one row twice and hides another.
  return [primary, { id: 'asc' }];
}

/** The filters as SQL: an absent filter is the absence of a clause, not a wildcard. */
function filteredWhere(query: PatchingQuery): Prisma.security_findingsWhereInput {
  return unresolvedWhere({
    ...(query.source === 'all' ? {} : { source: query.source }),
    ...(query.severity === 'all' ? {} : { severity: query.severity }),
    // One stored verdict, so the count and the page select exactly the rows the badge names.
    ...(query.reachability === 'all' ? {} : { reachability: query.reachability }),
  });
}

/**
 * The one row→`PatchingFinding` mapper.
 *
 * WHY null for an unknown source instead of a label: the contract's enum is the grouping key, and a
 * row written by a future producer must surface as a visible gap in the ingest boundary, not be
 * folded into a group the page claims is complete.
 *
 * WHY exported: the paged read, the digest read and the tests all have to go through it. A second
 * mapping beside this one is how one surface starts rendering `first_seen` in a different shape from
 * another.
 */
export function mapPatchingFinding(
  row: FindingRow,
  waivers: readonly WaiverRow[],
  now: Date,
): PatchingFinding | null {
  if (!isPatchingSource(row.source)) return null;
  return {
    id: row.id,
    source: row.source,
    key: row.key,
    kind: row.kind,
    severity: isPatchingSeverity(row.severity) ? row.severity : null,
    subject: row.subject,
    installed: row.installed,
    available: row.available,
    title: row.title,
    url: row.url,
    host: row.host,
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
    // The column the filter reads, so a row cannot render one verdict and be found under another.
    reachability: storedReachability(row.reachability),
    waiver: waiverStateFor(row, waivers, now),
  };
}

/** Maps a page of rows, dropping the ones the contract cannot place. */
function mapPatchingFindings(
  rows: readonly FindingRow[],
  waivers: readonly WaiverRow[],
  now: Date,
): PatchingFinding[] {
  return rows.flatMap((row) => {
    const mapped = mapPatchingFinding(row, waivers, now);
    return mapped === null ? [] : [mapped];
  });
}

/**
 * The live waiver rows: the whole set of decisions that currently suppress something.
 *
 * WHY one function for both callers: "live" is `ended_at: null` ordered by the date the decision
 * is due, and a second copy of that predicate is how the page and CI would start disagreeing.
 */
function liveWaiverRows() {
  return prisma.security_waivers.findMany({
    where: { ended_at: null },
    orderBy: [{ review_by: 'asc' }],
  });
}

/**
 * The administrator who signed each waiver, in one query; a deleted account stays null.
 */
async function waiverOwners(
  rows: readonly { readonly created_by: number }[],
): Promise<Map<number, string>> {
  return loadActorNames(rows.map((row) => row.created_by));
}

/** A waiver row as the page renders it. One mapper, beside {@link mapPatchingFinding}. */
function mapPatchingWaiver(
  row: WaiverRow,
  owners: ReadonlyMap<number, string>,
  now: Date,
): PatchingWaiver {
  return {
    id: row.id,
    source: row.source,
    match: row.match,
    reason: row.reason,
    reviewBy: row.review_by.toISOString(),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    createdByName: owners.get(row.created_by) ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    expired: isWaiverExpired(row, now),
  };
}

/**
 * The two aggregates the four cards need, and nothing else.
 *
 * WHY `groupBy(source)` plus one count: those are exactly the numbers `buildPatchingCards` reads —
 * one row per producer family, and the count of rootfs rows that name a fix version — so the card
 * arithmetic still lives in one function while the counting happens in SQL.
 */
async function readFindingCounts(): Promise<PatchingFindingCounts> {
  const [bySourceRows, rootfsWithAvailable] = await Promise.all([
    prisma.security_findings.groupBy({
      by: ['source'],
      where: unresolvedWhere(),
      _count: { _all: true },
    }),
    prisma.security_findings.count({
      where: unresolvedWhere({ source: 'rootfs', available: { not: null } }),
    }),
  ]);
  const bySource: Record<PatchingSource, number> = { diun: 0, rootfs: 0, osv: 0 };
  for (const row of bySourceRows) {
    if (isPatchingSource(row.source)) bySource[row.source] = row._count._all;
  }
  return { bySource, rootfsWithAvailable };
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

/** What the paged read hands back: one page of rows plus the numbers describing the whole set. */
export async function readPatchingPage(
  input: PatchingQueryInput = {},
  now: Date = new Date(),
): Promise<PatchingListState> {
  const requested = readPatchingQuery(input);
  const [waivers, counts, total] = await Promise.all([
    liveWaiverRows(),
    readFindingCounts(),
    prisma.security_findings.count({ where: filteredWhere(requested) }),
  ]);

  // WHY the page is clamped after the count: `?page=999` on a feed that shrank would otherwise
  // render an empty table, which on this page is indistinguishable from "nothing is wrong".
  const page = clampPatchingPage(requested.page, total);
  const query: PatchingQuery = { ...requested, page };
  const rows = await readPageRows(query, total);

  const owners = await waiverOwners(waivers);
  return {
    // The groups this page covers: `groupFindings` keeps the contract order and puts the worst
    // finding first inside a group, which is the presentation the page has always had.
    groups: groupFindings(mapPatchingFindings(rows, waivers, now)),
    waivers: waivers.map((row) => mapPatchingWaiver(row, owners, now)),
    cards: buildPatchingCards(counts, waivers, now),
    page: {
      query,
      pageSize: PATCHING_PAGE_SIZE,
      total,
      pageCount: patchingPageCount(total),
    },
  };
}

/**
 * The numbers the overview cards and the signal job render, plus the one digest derived from them.
 *
 * WHY the digest is part of the snapshot and not a second read: the card, the channel and the page
 * must agree about what is wrong and how bad it is, so all three consume one computation. A caller
 * that only wants the cards ignores `signal`; nothing else has to be queried to get it.
 */
export interface PatchingSnapshot {
  readonly waivers: readonly PatchingWaiver[];
  readonly cards: PatchingCards;
  readonly signal: SecurityDigest;
}

/** Unresolved rows per producer family and per severity, with the unrated ones counted apart. */
interface FeedTotals {
  readonly bySeverity: Record<PatchingSeverity, number>;
  readonly bySource: Record<PatchingSource, number>;
  readonly unrated: number;
}

/**
 * One `groupBy(source, severity)` gives both totals the digest needs.
 *
 * WHY one query and not two: the same rows answer both questions, and scanning the feed twice to
 * count it twice is the kind of cost this refactor exists to remove.
 *
 * WHY the predicate is a parameter: a completed scan reports numbers about the rows its own push
 * settled, and those must come from the same aggregation as the page's — never a second count.
 */
async function readFeedTotals(
  where: Prisma.security_findingsWhereInput = unresolvedWhere(),
): Promise<FeedTotals> {
  const rows = await prisma.security_findings.groupBy({
    by: ['source', 'severity'],
    where,
    _count: { _all: true },
  });
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
  return { bySeverity, bySource, unrated };
}

/**
 * The most severe unresolved row; ties go to the one seen first.
 *
 * WHY two small queries instead of sorting the feed: the severity rank is a contract order, not a
 * column order, so the top family is read from the totals and then its earliest sighting is taken
 * with `take: 1`. An unrated row (Diun) only wins when nothing rated exists — it ranks last.
 */
async function readWorstFinding(
  totals: FeedTotals,
  waivers: readonly WaiverRow[],
  now: Date,
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

/**
 * Every row a live waiver touches, mapped — the only rows whose waiver state is not `none`.
 *
 * WHY a count and then a fetch of that size: the set is bounded by what the waivers reach, not by
 * the feed, and asking SQL how many rows that is keeps the fetch a bounded read rather than an open
 * one. A waiver that matches tens of thousands of rows is an operator error the waiver gate already
 * reports; the numbers here stay correct either way.
 */
async function readWaivedFindings(
  waivers: readonly WaiverRow[],
  now: Date,
  scope: readonly Prisma.security_findingsWhereInput[] = [],
): Promise<PatchingFinding[]> {
  const cover = waiverCoverWhere(waivers);
  if (cover === null) return [];
  const where = unresolvedWhere({ AND: [...scope, cover] });
  const total = await prisma.security_findings.count({ where });
  if (total === 0) return [];
  const rows = await prisma.security_findings.findMany({
    where,
    orderBy: [{ id: 'asc' }],
    take: total,
  });
  return mapPatchingFindings(rows, waivers, now);
}

/**
 * The facts the digest is built from: aggregates plus the few rows a message can name.
 *
 * WHY not the finding list: the digest reports numbers about the whole feed and names at most
 * {@link SIGNAL_RULES.maxLines} of it, so every number here is a SQL count and every list is either
 * bounded by `take` or bounded by the waivers.
 */
async function readSignalFacts(
  waivers: readonly WaiverRow[],
  mappedWaivers: readonly PatchingWaiver[],
  counts: PatchingFindingCounts,
  now: Date,
): Promise<PatchingSignalFacts> {
  const touched = untouchedWhere(waivers);
  // WHY the totals come first and alone: the worst finding is chosen FROM them (the top family that
  // has rows), so the query that picks it cannot be in the same fan-out as the query that counts.
  const totals = await readFeedTotals();

  const [aged, waived, worst, oldest, criticals] = await Promise.all([
    prisma.security_findings.count({
      where: unresolvedWhere({ first_seen: { lte: agedCutoff(now) } }),
    }),
    readWaivedFindings(waivers, now),
    readWorstFinding(totals, waivers, now),
    prisma.security_findings
      .findFirst({
        where: unresolvedWhere(touched),
        orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
      })
      .then((row) => (row === null ? null : mapPatchingFinding(row, waivers, now))),
    prisma.security_findings.findMany({
      // WHY the push severities with no waiver at all: the message starts on a push-worthy row that
      // no live waiver touches. A row whose waiver lapsed is already reported as the lapsed decision
      // (see `buildSecurityDigest`), and the count of the others comes from the totals — which is
      // why this list can stop at what a message prints.
      where: unresolvedWhere({ severity: { in: [...SIGNAL_RULES.pushSeverities] }, ...touched }),
      orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
      take: SIGNAL_RULES.maxLines,
    }),
  ]);

  return {
    cards: buildPatchingCards(counts, waivers, now),
    waivers: mappedWaivers,
    bySource: totals.bySource,
    bySeverity: totals.bySeverity,
    unrated: totals.unrated,
    aged,
    waived,
    criticals: mapPatchingFindings(criticals, waivers, now),
    worst,
    oldest,
  };
}

/**
 * The card numbers and the digest, from aggregates.
 *
 * WHY this no longer returns the finding list: the page reads one page of findings through
 * {@link readPatchingPage}, and the overview and the signal job need numbers and at most
 * {@link SIGNAL_RULES.maxLines} named rows. Making the digest walk every finding was what put
 * 34,610 rows in front of every render of both surfaces.
 */
export async function readPatchingSnapshot(now: Date = new Date()): Promise<PatchingSnapshot> {
  const [waivers, staleness] = await Promise.all([
    liveWaiverRows(),
    // WHY the backup age is read beside the findings and not from them: a backup age is not a
    // finding (docs/SECURITY-FEED.md fixes the producer contract), so it arrives as its own reading
    // and the digest joins the two. This call never throws — an unreachable scrape target is an
    // `unknown` reading — so it cannot turn a page render into an error. Read through the short
    // render cache: this function runs on every request, the series move once per backup run, and a
    // dead target would otherwise cost every render the request timeout.
    readStalenessSnapshotCached(),
  ]);
  const [counts, owners] = await Promise.all([readFindingCounts(), waiverOwners(waivers)]);
  const mappedWaivers = waivers.map((row) => mapPatchingWaiver(row, owners, now));
  const facts = await readSignalFacts(waivers, mappedWaivers, counts, now);
  return {
    waivers: mappedWaivers,
    cards: facts.cards,
    signal: buildSecurityDigest(facts, staleness, now),
  };
}

/**
 * The waiver table as CI reads it.
 *
 * WHY a row outside the source enum is an error and not a label: the export is the input to the
 * gate, and the gate refuses a source it cannot place. Substituting one here would produce a file
 * that says a Trivy waiver exists for a row that is not a Trivy waiver, so the export stops and
 * names the row instead — a wrong export must never look like a complete one.
 */
function toWaiverRecord(
  row: {
    readonly id: number;
    readonly source: string;
    readonly match: string;
    readonly reason: string;
    readonly review_by: Date;
    readonly created_at: Date;
    readonly created_by: number;
    readonly ended_at: Date | null;
  },
  owner: string | undefined,
): WaiverRecord {
  if (!isPatchingSource(row.source)) {
    throw new Error(
      `security_waivers row ${row.id} has source ${JSON.stringify(row.source)}, outside the contract enum — fix the row before exporting`,
    );
  }
  return {
    id: row.id,
    source: row.source,
    match: row.match,
    reason: row.reason,
    reviewBy: row.review_by.toISOString(),
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    createdByName: owner ?? null,
    endedAt: null,
  };
}

/**
 * Renders the export CI's waiver gate and scanners read, from the live rows of the one table.
 *
 * WHY the caller supplies the clock: `generatedAt` is part of what CI judges (an export nobody has
 * re-rendered in `MAX_EXPORT_AGE_DAYS` fails), so a test drives it instead of waiting.
 */
export async function readWaiverExport(now: Date = new Date()): Promise<WaiverExport> {
  const rows = await liveWaiverRows();
  const owners = await waiverOwners(rows);
  return {
    version: WAIVER_EXPORT_VERSION,
    generatedAt: now.toISOString(),
    waivers: rows.map((row) => toWaiverRecord(row, owners.get(row.created_by))),
  };
}

/**
 * One unresolved row the bulk waiver judges: the columns the decision needs and nothing else.
 *
 * WHY so few: the bulk action only asks whether the CVE is reachable and what module state made it
 * that way, so the row travels without its versions, URLs or detail blob.
 */
export interface BulkWaiveCandidate {
  readonly id: number;
  readonly key: string;
  readonly title: string | null;
  readonly host: string | null;
  readonly reachability: string;
}

/** One live decision: what it covers and the source it covers it for. */
export interface BulkWaiveWaiver {
  readonly source: string;
  readonly match: string;
  readonly ended_at: Date | null;
}

/** The feed the bulk waiver plans over: every candidate row, and every decision already standing. */
export interface BulkWaiveFeed {
  readonly rows: readonly BulkWaiveCandidate[];
  readonly waivers: readonly BulkWaiveWaiver[];
}

/**
 * The rows a bulk waiver judges and the live decisions over them.
 *
 * WHY this lives here: this module is the only one allowed to query the two tables, so the bulk
 * write asks it instead of opening a second read — which keeps "unresolved" and "live waiver"
 * defined exactly once. The source is a parameter because the bulk action pins it to the host scan.
 */
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

/** The slice of the feed a completed scan's message describes: who spoke, for which box, and when. */
export interface ScanScope {
  readonly source: string;
  readonly host: string | null;
  readonly runStartedAt: Date;
}

/**
 * The rows a completed push settled, as filters.
 *
 * WHY the host clause mirrors the ingest's resolution predicate: a complete push settles its own
 * host's rows AND the rows written before the envelope carried a host. Counting only
 * `host = box-a` would report a smaller feed than the one the run just closed.
 */
function scanScopeFilters(scan: ScanScope): Prisma.security_findingsWhereInput[] {
  const filters: Prisma.security_findingsWhereInput[] = [{ source: scan.source }];
  if (scan.host !== null) filters.push({ OR: [{ host: scan.host }, { host: null }] });
  return filters;
}

/** The CRITICAL rows a message can name, oldest first, each with the verdict the page would give. */
async function readScanCriticals(
  scan: ScanScope,
  waivers: readonly WaiverRow[],
  now: Date,
): Promise<ScanCriticalRow[]> {
  const rows = await prisma.security_findings.findMany({
    where: unresolvedWhere({ AND: [...scanScopeFilters(scan), { severity: 'CRITICAL' }] }),
    orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
    take: SCAN_CRITICAL_LINES,
  });
  return mapPatchingFindings(rows, waivers, now).map((finding) => ({
    key: finding.key,
    subject: finding.subject,
    waiver: finding.waiver.status,
    reviewBy: finding.waiver.status === 'none' ? null : finding.waiver.reviewBy,
  }));
}

/**
 * One completed run, as its announcement reads it.
 *
 * WHY it lives here and not in the announcement module: this is the only module allowed to query
 * the two tables (see the contract test), so the message asks the read path instead of opening a
 * second definition of "unresolved" and "live waiver". Every number is scoped to the push, because
 * the header names one host — a whole-feed count would be a different claim under the same words.
 *
 * WHY `added` compares against the run's start: `first_seen` is stamped once, by the panel, on
 * insert, so the rows this run created are the ones first seen after it began.
 */
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
      high: totals.bySeverity.HIGH,
      medium: totals.bySeverity.MEDIUM,
      low: totals.bySeverity.LOW,
      unrated: totals.unrated,
    },
    waived: waivedRows.filter((finding) => finding.waiver.status === 'active').length,
    criticalRows,
  };
}
