import type { Prisma, security_waivers } from '@prisma/client';

import type { Reachability } from '@/lib/security/kernel-reachability';
import { waiverCovers, type PatchingSeverity } from '@/lib/security/patching';
import { waiverCoverWhere } from '@/lib/security/waiver-cover';

/**
 * The flip a waiver cannot follow.
 *
 * A waiver is keyed on the CVE and carries no host, so nothing about it knows which box was
 * scanned. When a row was written `unreachable` — its module was not loaded — and the same row is
 * later written `reachable`, the decision that suppresses it was taken about a state that no longer
 * holds. This module is the one place that remembers that: it is detected at ingest (the only place
 * a verdict changes), stored as a row with its moment, and read back by the page and the signal.
 *
 * WHY it is not a boolean on the finding: "waived and reachable" can be true for a row whose waiver
 * was written for a reachable state and is therefore honest. What makes the defect is the CHANGE,
 * and only the ingest path can see one.
 */

/** The verdict a row held before this push overwrote it. Read from the row, never re-classified. */
export interface StoredVerdict {
  readonly id: number;
  readonly key: string;
  readonly reachability: string;
}

/** One row whose verdict became 'reachable' while a live waiver still covered it. */
export interface FlipCandidate {
  readonly findingId: number;
  readonly findingKey: string;
  readonly title: string | null;
  readonly host: string | null;
  readonly severity: string | null;
  /** The verdict it held before: unreachable | unknown. */
  readonly from: string;
}

/** The worst of the flipped set, as the page and the message name it. */
export interface FlipLead {
  readonly key: string;
  readonly title: string | null;
  readonly subject: string;
  readonly severity: PatchingSeverity | null;
  readonly host: string | null;
  readonly flippedAt: string;
}

/** What a reader is told: how many rows a waiver hides although they are reachable now. */
export interface WaivedReachable {
  readonly count: number;
  readonly worst: FlipLead | null;
}

/** A waiver as the one shared predicate needs it. */
type LiveWaiver = Pick<security_waivers, 'id' | 'source' | 'match' | 'ended_at'>;

/** The verdict of the row this push is about to write, keyed by the producer's identity. */
export async function readStoredVerdicts(
  client: Prisma.TransactionClient,
  source: string,
  keys: readonly string[],
): Promise<Map<string, StoredVerdict>> {
  if (keys.length === 0) return new Map();
  const rows = await client.security_findings.findMany({
    where: { source, key: { in: [...keys] } },
    select: { id: true, key: true, reachability: true },
  });
  return new Map(rows.map((row) => [row.key, row]));
}

/** The one definition of a flip: the row was NOT reachable, and now it is. */
export function isVerdictFlip(prior: string, verdict: Reachability): boolean {
  return prior !== 'reachable' && verdict === 'reachable';
}

/** The row a detected flip would be recorded as; `severity`/`host` are the ones just written. */
export function flipCandidate(
  stored: StoredVerdict,
  finding: { readonly key: string; readonly title: string | null },
  host: string | null,
  severity: string | null,
): FlipCandidate {
  return {
    findingId: stored.id,
    findingKey: finding.key,
    title: finding.title,
    host,
    severity,
    from: stored.reachability,
  };
}

/** The live decision that covers this row, by the same predicate the page renders. */
function coveringWaiver(waivers: readonly LiveWaiver[], candidate: FlipCandidate, source: string): LiveWaiver | null {
  const finding = { source, key: candidate.findingKey, title: candidate.title };
  return waivers.find((waiver) => waiverCovers(waiver, finding)) ?? null;
}

/**
 * Records every candidate a live waiver covers; returns how many were recorded.
 *
 * WHY the waiver read is lazy: a push that flips nothing (the overwhelming majority) must not pay
 * a second query, and the candidate list is empty for exactly those.
 */
export async function recordFlips(
  client: Prisma.TransactionClient,
  source: string,
  candidates: readonly FlipCandidate[],
  now: Date,
): Promise<number> {
  if (candidates.length === 0) return 0;
  const waivers = await client.security_waivers.findMany({
    where: { ended_at: null, source },
    select: { id: true, source: true, match: true, ended_at: true },
  });
  let recorded = 0;
  for (const candidate of candidates) {
    const waiver = coveringWaiver(waivers, candidate, source);
    if (waiver === null) continue;
    const fields = {
      host: candidate.host,
      severity: candidate.severity,
      finding_key: candidate.findingKey,
      from_verdict: candidate.from,
      waiver_id: waiver.id,
      flipped_at: now,
      cleared_at: null,
    };
    // One row per finding: a second flip re-opens it with a new moment instead of stacking history.
    await client.security_finding_flips.upsert({
      where: { finding_id: candidate.findingId },
      create: { finding_id: candidate.findingId, ...fields },
      update: fields,
    });
    recorded += 1;
  }
  return recorded;
}

/** A verdict that left 'reachable' stops the flip counting, whatever the waiver still says. */
export async function clearFlip(
  client: Prisma.TransactionClient,
  findingId: number,
  now: Date,
): Promise<void> {
  await client.security_finding_flips.updateMany({
    where: { finding_id: findingId, cleared_at: null },
    data: { cleared_at: now },
  });
}

/** Resolution is not a delete: the flip of a resolved row is closed, so the count cannot lag. */
export async function clearResolvedFlips(
  client: Prisma.TransactionClient,
  source: string,
  now: Date,
): Promise<void> {
  await client.security_finding_flips.updateMany({
    where: { cleared_at: null, finding: { source, resolved_at: { not: null } } },
    data: { cleared_at: now },
  });
}

/**
 * The findings a live waiver hides although their stored verdict is 'reachable' and a flip is open.
 *
 * WHY `resolved_at: null` is in here: a resolved row is not reachable in any sense a reader acts
 * on, and the count must stop the moment it resolves even if the clearing write never ran (an
 * operator can resolve a feed, a restore can bring a row back). The stored fact says what happened;
 * this clause says whether it still holds.
 *
 * WHY `null`: "no live waiver covers anything" means no row can be hidden by one — an empty set,
 * not an unrestricted one. The caller must turn it into "nothing matches", never into "no filter".
 */
export function flippedUnderWaiverWhere(
  waivers: readonly LiveWaiver[],
): Prisma.security_findingsWhereInput | null {
  const cover = waiverCoverWhere(waivers);
  if (cover === null) return null;
  return {
    AND: [
      cover,
      { reachability: 'reachable' },
      { resolved_at: null },
      { flip: { is: { cleared_at: null } } },
    ],
  };
}
