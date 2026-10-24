import type { security_findings, security_waivers } from '@prisma/client';

// The security feed's vocabulary, in one place: the ingest boundary validates against
// these constants and the page renders their order, so a new source or severity is one
// edit rather than a second list that drifts. The contract (docs/SECURITY-FEED.md) fixes
// the source enum; extending it is a contract change, not a panel decision.
export const PATCHING_SOURCES = ['diun', 'rootfs', 'osv'] as const;
export type PatchingSource = (typeof PATCHING_SOURCES)[number];

export const PATCHING_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type PatchingSeverity = (typeof PATCHING_SEVERITIES)[number];

/** Severity order inside a source group: the worst finding reads first. */
const SEVERITY_RANK: Record<PatchingSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

export function isPatchingSource(value: unknown): value is PatchingSource {
  return typeof value === 'string' && (PATCHING_SOURCES as readonly string[]).includes(value);
}

export function isPatchingSeverity(value: unknown): value is PatchingSeverity {
  return typeof value === 'string' && (PATCHING_SEVERITIES as readonly string[]).includes(value);
}

/** `none` until a live waiver covers the finding; `expired` is surfaced, never hidden. */
export type WaiverState =
  | { readonly status: 'none' }
  | { readonly status: 'active'; readonly reviewBy: string }
  | { readonly status: 'expired'; readonly reviewBy: string };

export interface PatchingFinding {
  readonly id: number;
  readonly source: PatchingSource;
  readonly key: string;
  readonly kind: string;
  readonly severity: PatchingSeverity | null;
  readonly subject: string;
  readonly installed: string | null;
  readonly available: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly waiver: WaiverState;
}

export interface PatchingWaiver {
  readonly id: number;
  readonly source: string;
  readonly match: string;
  readonly reason: string;
  readonly reviewBy: string;
  readonly createdAt: string;
  readonly createdBy: number;
  readonly endedAt: string | null;
  readonly expired: boolean;
}

export interface PatchingGroup {
  readonly source: PatchingSource;
  readonly findings: readonly PatchingFinding[];
}

/** The four overview numbers. They are derived here so the page and cards cannot disagree. */
export interface PatchingCards {
  /** Running container images whose registry now serves a different digest. */
  readonly staleImages: number;
  /** Unresolved findings from the two CVE scanners (rootfs + osv). */
  readonly unresolvedCves: number;
  /** Waivers whose review date has passed and which nobody has ended. */
  readonly expiredWaivers: number;
  /** Unresolved host OS packages for which the producer named a fixed version. */
  readonly hostOsUpdates: number;
}

export interface PatchingState {
  readonly groups: readonly PatchingGroup[];
  readonly waivers: readonly PatchingWaiver[];
  readonly cards: PatchingCards;
}

/**
 * Whether a waiver covers a finding.
 *
 * WHY the CVE containment check: the contract lets a waiver name the finding key *or* a CVE
 * id the finding carries (a Trivy row's key is `CVE-…|package`, an OSV row's key is an
 * advisory id), so a waiver for one CVE has to reach the row that carries it rather than
 * demanding the operator reproduce the producer's whole key.
 */
export function waiverCovers(
  waiver: Pick<security_waivers, 'source' | 'match' | 'ended_at'>,
  finding: Pick<security_findings, 'source' | 'key' | 'title'>,
): boolean {
  if (waiver.ended_at !== null) return false;
  if (waiver.source !== finding.source) return false;
  if (waiver.match === finding.key) return true;
  return finding.key.includes(waiver.match) || (finding.title?.includes(waiver.match) ?? false);
}

/**
 * The waiver state a finding renders with. An active waiver wins over an expired one for
 * the same finding — a fresh decision supersedes a lapsed one — but the expired waiver row
 * itself still counts on the overview.
 */
export function waiverStateFor(
  finding: Pick<security_findings, 'source' | 'key' | 'title'>,
  waivers: readonly Pick<security_waivers, 'source' | 'match' | 'ended_at' | 'review_by'>[],
  now: Date,
): WaiverState {
  let expired: string | null = null;
  let active: string | null = null;
  for (const waiver of waivers) {
    if (!waiverCovers(waiver, finding)) continue;
    const reviewBy = waiver.review_by.toISOString();
    if (waiver.review_by.getTime() < now.getTime()) {
      expired = reviewBy;
    } else if (active === null || reviewBy > active) {
      active = reviewBy;
    }
  }
  if (active !== null) return { status: 'active', reviewBy: active };
  if (expired !== null) return { status: 'expired', reviewBy: expired };
  return { status: 'none' };
}

export function isWaiverExpired(
  waiver: Pick<security_waivers, 'ended_at' | 'review_by'>,
  now: Date,
): boolean {
  return waiver.ended_at === null && waiver.review_by.getTime() < now.getTime();
}

/**
 * The four numbers, from the same unresolved rows the page lists.
 *
 * WHY `hostOsUpdates` counts only rows with an `available` version: "an update is available"
 * is the claim the card makes, and a rootfs finding whose fix version the producer did not
 * name would make the number say more than the feed knows.
 */
export function buildPatchingCards(
  findings: readonly Pick<security_findings, 'source' | 'severity' | 'available' | 'resolved_at'>[],
  waivers: readonly Pick<security_waivers, 'ended_at' | 'review_by'>[],
  now: Date,
): PatchingCards {
  const unresolved = findings.filter((finding) => finding.resolved_at === null);
  return {
    staleImages: unresolved.filter((finding) => finding.source === 'diun').length,
    unresolvedCves: unresolved.filter(
      (finding) => finding.source === 'rootfs' || finding.source === 'osv',
    ).length,
    expiredWaivers: waivers.filter((waiver) => isWaiverExpired(waiver, now)).length,
    hostOsUpdates: unresolved.filter(
      (finding) => finding.source === 'rootfs' && finding.available !== null,
    ).length,
  };
}

/** Groups unresolved findings by source in contract order, severity first inside each. */
export function groupFindings(
  findings: readonly PatchingFinding[],
): readonly PatchingGroup[] {
  const groups: PatchingGroup[] = [];
  for (const source of PATCHING_SOURCES) {
    const rows = findings
      .filter((finding) => finding.source === source)
      .sort((left, right) => {
        const severity =
          (left.severity === null ? 99 : SEVERITY_RANK[left.severity]) -
          (right.severity === null ? 99 : SEVERITY_RANK[right.severity]);
        if (severity !== 0) return severity;
        return right.lastSeen.localeCompare(left.lastSeen);
      });
    if (rows.length > 0) groups.push({ source, findings: rows });
  }
  return groups;
}
