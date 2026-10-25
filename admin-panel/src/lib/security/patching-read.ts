import { loadActorNames } from '@/lib/admin-names';
import { prisma } from '@/lib/prisma';
import {
  buildPatchingCards,
  groupFindings,
  isPatchingSeverity,
  isPatchingSource,
  isWaiverExpired,
  waiverStateFor,
  type PatchingFinding,
  type PatchingGroup,
  type PatchingState,
  type PatchingWaiver,
} from '@/lib/security/patching';
import { buildSecurityDigest, type SecurityDigest } from '@/lib/security/signal';
import { readStalenessSnapshotCached } from '@/lib/security/staleness';
import {
  WAIVER_EXPORT_VERSION,
  type WaiverExport,
  type WaiverRecord,
} from '@/lib/security/waiver-gate';

/**
 * The one read path for the security feed.
 *
 * WHY one module: the patching page and the four overview cards both answer questions about
 * the same two tables, and a second query beside this one would let the page and the cards
 * disagree about what "unresolved" or "expired" means. The server action gates; this reads.
 *
 * WHY unresolved is `resolved_at: null` and not a delete: the ingest route resolves rows a
 * complete push no longer mentions, so the unresolved set is exactly what the producers
 * reported most recently. History stays in the table for the audit trail.
 *
 * WHY the waiver export is rendered here too: the file CI reads has to mean exactly what the page
 * shows, so it comes from the same rows through the same mapping rather than from a query beside
 * this one (docs/SECURITY-FEED.md §"Suppressions in CI").
 */

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
 * The state the page renders, plus the one digest derived from it.
 *
 * WHY the digest is part of the snapshot and not a second read: the card, the channel and the page
 * must agree about what is wrong and how bad it is, so all three consume one computation of the same
 * rows (the read path's rule — see the module comment). A caller that only wants the tables ignores
 * `signal`; nothing else has to be queried to get it.
 */
export type PatchingSnapshot = PatchingState & { readonly signal: SecurityDigest };

/**
 * The administrator who signed each waiver, in one query; a deleted account stays null.
 */
async function waiverOwners(
  rows: readonly { readonly created_by: number }[],
): Promise<Map<number, string>> {
  return loadActorNames(rows.map((row) => row.created_by));
}

export async function readPatchingSnapshot(now: Date = new Date()): Promise<PatchingSnapshot> {
  const [findings, waivers, staleness] = await Promise.all([
    prisma.security_findings.findMany({
      where: { resolved_at: null },
      orderBy: [{ source: 'asc' }, { last_seen: 'desc' }],
    }),
    liveWaiverRows(),
    // WHY the backup age is read beside the findings and not from them: a backup age is not a
    // finding (docs/SECURITY-FEED.md fixes the producer contract), so it arrives as its own reading
    // and the digest joins the two. This call never throws — an unreachable scrape target is an
    // `unknown` reading — so it cannot turn a page render into an error. Read through the short
    // render cache: this function runs on every request, the series move once per backup run, and a
    // dead target would otherwise cost every render the request timeout.
    readStalenessSnapshotCached(),
  ]);

  const owners = await waiverOwners(waivers);

  const mapped: PatchingFinding[] = findings.flatMap((row) => {
    // Why refuse an unknown source instead of labelling it: the contract's enum is the
    // grouping key, and a row written by a future producer must surface as a visible gap in
    // the ingest boundary, not be folded into a group the page claims is complete.
    if (!isPatchingSource(row.source)) return [];
    return [
      {
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
        waiver: waiverStateFor(row, waivers, now),
      },
    ];
  });

  const mappedWaivers: PatchingWaiver[] = waivers.map((row) => ({
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
  }));

  const groups: readonly PatchingGroup[] = groupFindings(mapped);
  const state: PatchingState = {
    groups,
    waivers: mappedWaivers,
    cards: buildPatchingCards(findings, waivers, now),
  };
  return { ...state, signal: buildSecurityDigest(state, staleness, now) };
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
