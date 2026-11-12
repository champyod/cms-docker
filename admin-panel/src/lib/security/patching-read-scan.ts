import type { Prisma, security_findings } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { PatchingFinding, PatchingSeverity } from '@/lib/security/patching';
import { liveWaiverRows, readFeedTotals, readWaivedFindings } from '@/lib/security/patching-read';
import { mapPatchingFindings } from '@/lib/security/patching-read-rows';
import type { FeedTotals } from '@/lib/security/patching-read-totals';
import { runScopeWhere, untouchedWhere } from '@/lib/security/patching-read-where';
import type { WaiverRow } from '@/lib/security/patching-read-types';
import {
  SCAN_CRITICAL_LINES,
  type ScanCriticalRow,
  type ScanJudged,
  type ScanReachability,
  type ScanRun,
  type ScanRunCounts,
  type ScanRunFacts,
} from '@/lib/security/scan-report';

// One finished run, counted: the numbers the announcement prints, and nothing the page would count differently.
// WHY this is part of the read path: only `patching-read*` may query the two tables, and this arm reads the
// same rows through the same helpers, so "unwaived" has one definition rather than a second one here.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Reachable first, then the unjudged, then the rows the classifier could rule out. */
const NAMED_ORDER: readonly ScanReachability[] = ['reachable', 'unknown', 'unreachable'];

/** The rows a live waiver actually covers: SQL narrowed the candidates, the mapper decides. */
function activeRows(covered: readonly PatchingFinding[]): PatchingFinding[] {
  return covered.filter((finding) => finding.waiver.status === 'active');
}

/** The message's four buckets; UNKNOWN and the unrated rows share one, because neither is triaged. */
function unwaivedCounts(totals: FeedTotals, active: readonly PatchingFinding[]): ScanRunCounts {
  const live = (severity: PatchingSeverity): number =>
    active.filter((row) => row.severity === severity).length;
  const unratedRows = active.filter((row) => row.severity === null).length;
  return {
    high: totals.bySeverity.HIGH - live('HIGH'),
    medium: totals.bySeverity.MEDIUM - live('MEDIUM'),
    low: totals.bySeverity.LOW - live('LOW'),
    unrated: totals.unrated + totals.bySeverity.UNKNOWN - live('UNKNOWN') - unratedRows,
  };
}

/** The soonest date a live waiver over this run's rows comes up for review, as `YYYY-MM-DD`. */
function soonestReview(active: readonly PatchingFinding[]): string | null {
  let soonest: string | null = null;
  for (const row of active) {
    if (row.waiver.status !== 'active') continue;
    const due = row.waiver.reviewBy;
    if (soonest === null || due < soonest) soonest = due;
  }
  return soonest === null ? null : soonest.slice(0, 10);
}

function ageInDays(firstSeen: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(firstSeen).getTime()) / DAY_MS));
}

/** One reachability bucket, oldest first: bounded, so no query ever hands back the feed. */
async function bucketRows(
  where: Prisma.security_findingsWhereInput,
  reachability: ScanReachability,
): Promise<security_findings[]> {
  return prisma.security_findings.findMany({
    where: { ...where, severity: 'CRITICAL', reachability },
    orderBy: [{ first_seen: 'asc' }, { id: 'asc' }],
    take: SCAN_CRITICAL_LINES,
  });
}

/** The rows L3 may name: never one a waiver covers, reachable first, bounded by the message's cap. */
// WHY the untouched predicate: a CRITICAL under a live waiver is handled, and naming it is the false alarm.
async function namedCriticals(
  scope: Prisma.security_findingsWhereInput,
  waivers: readonly WaiverRow[],
  now: Date,
): Promise<ScanCriticalRow[]> {
  const where = { ...scope, ...untouchedWhere(waivers) };
  const buckets = await Promise.all(NAMED_ORDER.map((reachability) => bucketRows(where, reachability)));
  const rows = mapPatchingFindings(buckets.flat(), waivers, now).slice(0, SCAN_CRITICAL_LINES);
  return rows.map((finding) => ({
    key: finding.key,
    subject: finding.subject,
    reachability: finding.reachability,
    ageDays: ageInDays(finding.firstSeen, now),
  }));
}

/** The classifier's split over the run's unresolved rows, whatever their waiver state. */
async function judgedSplit(scope: Prisma.security_findingsWhereInput): Promise<ScanJudged> {
  const rows = await prisma.security_findings.groupBy({
    by: ['reachability'],
    where: scope,
    _count: { _all: true },
  });
  let reachable = 0;
  let unreachable = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.reachability === 'reachable') reachable += row._count._all;
    else if (row.reachability === 'unreachable') unreachable += row._count._all;
    else unknown += row._count._all;
  }
  return { reachable, unreachable, unknown };
}

/** One run as its announcement reads it: every number unwaived, over the box's whole standing list. */
export async function readScanRunFacts(run: ScanRun, now: Date = new Date()): Promise<ScanRunFacts> {
  const waivers = await liveWaiverRows();
  const scope = runScopeWhere(run.host);
  const [totals, added, covered, criticalRows, judged] = await Promise.all([
    readFeedTotals(scope),
    prisma.security_findings.count({ where: { ...scope, first_seen: { gte: run.runStartedAt } } }),
    readWaivedFindings(waivers, now, [scope]),
    namedCriticals(scope, waivers, now),
    judgedSplit(scope),
  ]);
  const active = activeRows(covered);
  const counts = unwaivedCounts(totals, active);
  const criticals = totals.bySeverity.CRITICAL - active.filter((row) => row.severity === 'CRITICAL').length;
  return {
    host: run.host,
    runStartedAt: run.runStartedAt,
    lastPushAt: run.lastPushAt,
    // Every unwaived open row, the CRITICALs included: the block prints severities, the total is the list.
    standing: counts.high + counts.medium + counts.low + counts.unrated + criticals,
    added,
    criticals,
    counts,
    waived: active.length,
    nextReview: soonestReview(active),
    criticalRows,
    judged,
  };
}
