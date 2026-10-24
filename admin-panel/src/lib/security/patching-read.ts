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
 */
export async function readPatchingSnapshot(now: Date = new Date()): Promise<PatchingState> {
  const [findings, waivers] = await Promise.all([
    prisma.security_findings.findMany({
      where: { resolved_at: null },
      orderBy: [{ source: 'asc' }, { last_seen: 'desc' }],
    }),
    prisma.security_waivers.findMany({
      where: { ended_at: null },
      orderBy: [{ review_by: 'asc' }],
    }),
  ]);

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
    endedAt: row.ended_at?.toISOString() ?? null,
    expired: isWaiverExpired(row, now),
  }));

  const groups: readonly PatchingGroup[] = groupFindings(mapped);
  return {
    groups,
    waivers: mappedWaivers,
    cards: buildPatchingCards(findings, waivers, now),
  };
}
