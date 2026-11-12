import { loadActorNames } from '@/lib/admin-names';
import {
  isPatchingSeverity,
  isPatchingSource,
  isWaiverExpired,
  waiverStateFor,
  type PatchingFinding,
  type PatchingWaiver,
} from '@/lib/security/patching';
import { isReachability, type Reachability } from '@/lib/security/kernel-reachability';
import type { FindingRow, WaiverRow } from '@/lib/security/patching-read-types';
import type { WaiverRecord } from '@/lib/security/waiver-gate';

/** A stored value outside the three verdicts is unjudged, never a guess — and never a safe answer. */
function storedReachability(value: string): Reachability {
  return isReachability(value) ? value : 'unknown';
}

/** The one row→finding mapper: a source the contract cannot place maps to null, never to a label. */
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
export function mapPatchingFindings(
  rows: readonly FindingRow[],
  waivers: readonly WaiverRow[],
  now: Date,
): PatchingFinding[] {
  return rows.flatMap((row) => {
    const mapped = mapPatchingFinding(row, waivers, now);
    return mapped === null ? [] : [mapped];
  });
}

/** The administrator who signed each waiver, in one query; a deleted account stays null. */
export function waiverOwners(rows: readonly WaiverRow[]): Promise<Map<number, string>> {
  return loadActorNames(rows.map((row) => row.created_by));
}

/** A waiver row as the page renders it: the mapper beside {@link mapPatchingFinding}. */
export function mapPatchingWaiver(
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

/** A waiver row as CI reads it; a source outside the enum stops the export instead of being labelled. */
export function toWaiverRecord(row: WaiverRow, owner: string | undefined): WaiverRecord {
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
