import { prisma } from '@/lib/prisma';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { auditCursorFingerprint, type AuditCursorFrame } from '@/lib/live/frames';
import { AUDIT_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/** The newest row's id, or null on an empty log. */
async function readLatestAuditId(): Promise<string | null> {
  const newest = await prisma.audit_log.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return newest === null ? null : String(newest.id);
}

/**
 * The audit log's push channel: the newest row id, so the table reloads its own query when a row lands.
 *
 * Why a cursor and not the rows: the table's filters, sort and page belong to the page's query, and a
 * pushed row list would have to restate every one of them to stay in step with it.
 */
export const GET = createLiveStreamRoute<AuditCursorFrame>({
  permissions: ['audit:list', 'audit:read'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<AuditCursorFrame>({
      initial: { latestId: null },
      fingerprint: auditCursorFingerprint,
      tracks: [{ intervalMs: AUDIT_POLL_MS, read: async () => ({ latestId: await readLatestAuditId() }) }],
    })(connection),
});
