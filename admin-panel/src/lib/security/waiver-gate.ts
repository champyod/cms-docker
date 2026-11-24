import { isPatchingSource, MAX_FINDING_KEY_LENGTH, type PatchingSource } from '@/lib/security/patching';

/** Pure and dependency-free: CI, the renderer and the suite must evaluate the same rules against the same clock. */

/** Bumped when the export's shape changes, so an old file is refused instead of misread. */
export const WAIVER_EXPORT_VERSION = 1;

/** A rendering with no expiry is exactly what .trivyignore was; the bound fails the build rather than warning. */
export const MAX_EXPORT_AGE_DAYS = 30;

/** One live waiver, as the panel's read path renders it. */
export interface WaiverRecord {
  readonly id: number;
  readonly source: PatchingSource;
  readonly match: string;
  readonly reason: string;
  /** ISO instant the decision must be reviewed by. Never absent: see `parseWaiverExport`. */
  readonly reviewBy: string;
  readonly createdAt: string;
  /** The administrator who filed it; `createdByName` is null when that row no longer exists. */
  readonly createdBy: number;
  readonly createdByName: string | null;
  readonly endedAt: string | null;
}

/** The committed file CI reads. Machine-written by `scripts/security-waivers.ts export`. */
export interface WaiverExport {
  readonly version: number;
  readonly generatedAt: string;
  readonly waivers: readonly WaiverRecord[];
}

export type WaiverExportParse =
  | { readonly ok: true; readonly value: WaiverExport }
  | { readonly ok: false; readonly error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function oneWaiver(value: unknown, index: number): WaiverRecord | string {
  const row = asRecord(value);
  if (row === null) return `waivers[${index}] is not an object`;
  const source = row.source;
  if (!isPatchingSource(source)) {
    return `waivers[${index}].source is not one of diun, rootfs, osv`;
  }
  const id = row.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return `waivers[${index}].id is not a row id`;
  }
  const match = row.match;
  if (typeof match !== 'string' || match.trim() === '') {
    return `waivers[${index}].match is empty: a waiver has to say what it covers`;
  }
  if (match.length > MAX_FINDING_KEY_LENGTH) {
    return `waivers[${index}].match exceeds ${MAX_FINDING_KEY_LENGTH} characters`;
  }
  const reason = row.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    return `waivers[${index}].reason is empty: a waiver has to say why`;
  }
  // The file is a committed document a human can edit, so the boundary re-checks the column's rule.
  const reviewBy = isoInstant(row.reviewBy);
  if (reviewBy === null) {
    return `waivers[${index}].reviewBy is not a date: a waiver without one never expires`;
  }
  const createdAt = isoInstant(row.createdAt);
  if (createdAt === null) return `waivers[${index}].createdAt is not a date`;
  const createdBy = row.createdBy;
  if (typeof createdBy !== 'number' || !Number.isInteger(createdBy) || createdBy <= 0) {
    return `waivers[${index}].createdBy is not an administrator id: a waiver has to say who`;
  }
  const createdByName = row.createdByName;
  if (createdByName !== null && typeof createdByName !== 'string') {
    return `waivers[${index}].createdByName is not text`;
  }
  const endedAt = row.endedAt;
  if (endedAt !== null) {
    // The read path only exports live waivers, so an ended one is a hand-edit and is refused, not filtered.
    return `waivers[${index}] is ended: an export carries live decisions only`;
  }
  return {
    id,
    source,
    match: match.trim(),
    reason: reason.trim(),
    reviewBy,
    createdAt,
    createdBy,
    createdByName,
    endedAt: null,
  };
}

/** Every failure is a refusal: the safe reading of a file this module cannot understand is that nothing is licensed. */
export function parseWaiverExport(value: unknown): WaiverExportParse {
  const document = asRecord(value);
  if (document === null) return { ok: false, error: 'the export is not a JSON object' };
  if (document.version !== WAIVER_EXPORT_VERSION) {
    return {
      ok: false,
      error: `the export is version ${String(document.version)}, this gate reads ${WAIVER_EXPORT_VERSION}: re-render it`,
    };
  }
  const generatedAt = isoInstant(document.generatedAt);
  if (generatedAt === null) {
    return { ok: false, error: 'generatedAt is missing or not a date: re-render the export' };
  }
  if (!Array.isArray(document.waivers)) {
    return { ok: false, error: 'waivers is not an array' };
  }
  const waivers: WaiverRecord[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < document.waivers.length; index += 1) {
    const parsed = oneWaiver(document.waivers[index], index);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    if (seen.has(parsed.id)) return { ok: false, error: `waivers[${index}] repeats id ${parsed.id}` };
    seen.add(parsed.id);
    waivers.push(parsed);
  }
  return { ok: true, value: { version: WAIVER_EXPORT_VERSION, generatedAt, waivers } };
}

/** A waiver still covers its finding until the review date passes; ending it stops it at once. */
export function isWaiverLive(waiver: Pick<WaiverRecord, 'endedAt'>): boolean {
  return waiver.endedAt === null;
}

export function isWaiverPastReview(
  waiver: Pick<WaiverRecord, 'endedAt' | 'reviewBy'>,
  now: Date,
): boolean {
  if (waiver.endedAt !== null) return false;
  return new Date(waiver.reviewBy).getTime() < now.getTime();
}

/** An ended waiver must stop suppressing immediately, not at its review date. */
export function liveWaivers(
  waivers: readonly WaiverRecord[],
  now: Date,
): readonly WaiverRecord[] {
  return waivers.filter((waiver) => isWaiverLive(waiver) && !isWaiverPastReview(waiver, now));
}

/** One expired waiver, as the gate and the operator notice name it. */
export interface ExpiredWaiver {
  readonly id: number;
  readonly source: PatchingSource;
  readonly match: string;
  readonly reviewBy: string;
  readonly reason: string;
  readonly owner: string;
}

/** Expired waivers, oldest review date first: the one that lapsed longest ago reads first. */
export function expiredWaivers(
  waivers: readonly WaiverRecord[],
  now: Date,
): readonly ExpiredWaiver[] {
  return waivers
    .filter((waiver) => isWaiverPastReview(waiver, now))
    .map((waiver) => ({
      id: waiver.id,
      source: waiver.source,
      match: waiver.match,
      reviewBy: waiver.reviewBy,
      reason: waiver.reason,
      owner: waiver.createdByName ?? `admin #${String(waiver.createdBy)}`,
    }))
    .sort((left, right) => left.reviewBy.localeCompare(right.reviewBy));
}

/** The ignore file matches the vulnerability id alone, so the id is composed from the key. */
function suppressionId(waiver: WaiverRecord): string {
  const separator = waiver.match.indexOf('|');
  return (separator === -1 ? waiver.match : waiver.match.slice(0, separator)).trim();
}

/** Trivy's family is the feed's `rootfs` source, the same scanner that reports host OS packages. */
const TRIVY_SOURCE: PatchingSource = 'rootfs';
/** `bun audit` advisories are the dependency family the feed's `osv` producer reports. */
const AUDIT_SOURCE: PatchingSource = 'osv';

/** Expired waivers are omitted, so a bypassed second run still scans the finding. */
export function renderTrivyIgnore(waivers: readonly WaiverRecord[], now: Date): string {
  const lines = [
    '# GENERATED from the panel\'s security_waivers table. Do not edit, do not commit.',
    '# Rendered per CI run by admin-panel/scripts/security-waivers.ts from security/waivers.json.',
    '# Every id below is a live waiver a person signed with a review date; a finding with no',
    '# waiver is not suppressed, and an expired waiver is not written here at all.',
  ];
  for (const waiver of liveWaivers(waivers, now)) {
    if (waiver.source !== TRIVY_SOURCE) continue;
    // The id has to be on its own line, so the provenance rides in a comment above it.
    const owner = waiver.createdByName ?? `admin #${String(waiver.createdBy)}`;
    lines.push(
      `# waiver #${String(waiver.id)}, review by ${waiver.reviewBy.slice(0, 10)}, ${owner}: ${waiver.reason}`,
    );
    lines.push(suppressionId(waiver));
  }
  return `${lines.join('\n')}\n`;
}

/** The advisory ids `bun audit` may skip, one per line: the live `osv` waivers, and nothing else. */
export function renderAuditIgnoreIds(waivers: readonly WaiverRecord[], now: Date): readonly string[] {
  return liveWaivers(waivers, now)
    .filter((waiver) => waiver.source === AUDIT_SOURCE)
    .map(suppressionId)
    .filter((id) => id !== '');
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** One message that names ids, dates and owners: the operator must be able to act without opening the panel. */
export function waiverGateFailure(exported: WaiverExport, now: Date): string | null {
  const failures: string[] = [];

  const age = daysBetween(new Date(exported.generatedAt), now);
  if (age > MAX_EXPORT_AGE_DAYS) {
    failures.push(
      `the waiver export was rendered ${String(age)} days ago (${exported.generatedAt.slice(0, 10)}), ` +
        `older than the ${String(MAX_EXPORT_AGE_DAYS)}-day bound: re-render security/waivers.json`,
    );
  }
  if (age < 0) {
    failures.push(
      `the waiver export is dated ${exported.generatedAt.slice(0, 10)}, in the future: its clock or its contents are wrong`,
    );
  }

  const expired = expiredWaivers(exported.waivers, now);
  if (expired.length > 0) {
    const rows = expired.map(
      (waiver) =>
        `  #${String(waiver.id)} ${waiver.source} ${waiver.match}, review by ${waiver.reviewBy.slice(0, 10)}, ` +
        `signed by ${waiver.owner}: ${waiver.reason}`,
    );
    failures.push(
      `${String(expired.length)} waiver(s) are past their review date (today ${now.toISOString().slice(0, 10)}):\n` +
        `${rows.join('\n')}\n` +
        'Nothing is suppressed while a waiver is past its date, and this one keeps failing until it is ' +
        'ended: end it on the patching page (the decision is recorded) and file a new waiver with a ' +
        'later review date if it still applies.',
    );
  }

  if (failures.length === 0) return null;
  return failures.join('\n');
}
