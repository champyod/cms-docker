import { prisma } from '@/lib/prisma';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The board's change cursor: the newest audited ranking write, the newest submission, and how many
 * applied changes the projection holds.
 *
 * Why three signals and not the board itself: the board is a fold over every participation, so
 * building a fingerprint from it would cost what the read costs. Each part here is a lookup on an
 * index that already exists — an override is audited, a new submission can move a score, and the
 * subchange keys the scoring service adds are what moves the rest. A score rewritten in place on an
 * unchanged key is the one change this cursor cannot see.
 */
async function readRankingCursor(): Promise<string> {
  const [rankingAudit, newestSubmission, subchanges] = await Promise.all([
    prisma.audit_log.findFirst({ where: { entity: 'ranking' }, orderBy: { id: 'desc' }, select: { id: true } }),
    prisma.submissions.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
    prisma.ranking_subchanges.count(),
  ]);
  return `${rankingAudit === null ? '' : rankingAudit.id}:${newestSubmission === null ? '' : newestSubmission.id}:${subchanges}`;
}

/** The ranking board's push channel: the board page re-renders its own read when the cursor moves. */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['ranking:list', 'ranking:read'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readRankingCursor() }) }],
    })(connection),
});
