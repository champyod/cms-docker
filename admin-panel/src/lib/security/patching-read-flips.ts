import { prisma } from '@/lib/prisma';
import { isPatchingSeverity, PATCHING_SEVERITIES, type PatchingSeverity } from '@/lib/security/patching';
import type { WaiverRow } from '@/lib/security/patching-read-types';
import { flippedRowsWhere } from '@/lib/security/patching-read-where';
import type { FlipLead, WaivedReachable } from '@/lib/security/verdict-flip';

/** The row shape the lead is chosen from; `flip` is the open episode, which the predicate guarantees. */
interface FlipRow {
  readonly key: string;
  readonly title: string | null;
  readonly subject: string;
  readonly severity: string | null;
  readonly host: string | null;
  readonly flip: { readonly flipped_at: Date } | null;
}

/**
 * How many flipped rows are read to name the worst one.
 *
 * WHY a bound and not the count: a message names one CVE and the page filters the set itself, so
 * fifty rows answer "which is worst" for every fleet this has seen while keeping the read bounded
 * when a wide waiver covers thousands of rows.
 */
const LEAD_ROWS = 50;

/** Position in the contract's severity order; anything the contract cannot rate sorts last. */
function severityRank(severity: PatchingSeverity | null): number {
  return severity === null ? PATCHING_SEVERITIES.length : PATCHING_SEVERITIES.indexOf(severity);
}

function leadOf(row: FlipRow): FlipLead | null {
  if (row.flip === null) return null;
  return {
    key: row.key,
    title: row.title,
    subject: row.subject,
    severity: isPatchingSeverity(row.severity) ? row.severity : null,
    host: row.host,
    flippedAt: row.flip.flipped_at.toISOString(),
  };
}

/** The worst flipped row, ties to the earliest flip — the one that has been hidden longest. */
function worstOf(rows: readonly FlipRow[]): FlipLead | null {
  const leads = rows.flatMap((row) => {
    const lead = leadOf(row);
    return lead === null ? [] : [lead];
  });
  leads.sort((left, right) => {
    const rank = severityRank(left.severity) - severityRank(right.severity);
    return rank !== 0 ? rank : left.flippedAt.localeCompare(right.flippedAt);
  });
  return leads[0] ?? null;
}

/** The number the page banner states; the same clause the filter selects with. */
export function countWaivedReachable(waivers: readonly WaiverRow[]): Promise<number> {
  return prisma.security_findings.count({ where: flippedRowsWhere(waivers) });
}

/**
 * The set a waiver now hides although it is reachable: how many, and the worst of them.
 *
 * WHY this reads the findings and not the flip rows: the flip row is evidence, the finding is
 * what a reader acts on, and starting from the finding means the waiver predicate is the same
 * SQL predicate the page filters with rather than a second join to re-derive it.
 */
export async function readWaivedReachable(waivers: readonly WaiverRow[]): Promise<WaivedReachable> {
  const where = flippedRowsWhere(waivers);
  const [count, rows] = await Promise.all([
    prisma.security_findings.count({ where }),
    prisma.security_findings.findMany({
      where,
      select: {
        key: true,
        title: true,
        subject: true,
        severity: true,
        host: true,
        flip: { select: { flipped_at: true } },
      },
      orderBy: [{ first_seen: 'asc' }],
      take: LEAD_ROWS,
    }),
  ]);
  return { count, worst: worstOf(rows) };
}
