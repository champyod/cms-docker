import { LANE_VERBS } from '@/app/actions/evaluation-lanes-board';
import { prisma } from '@/lib/prisma';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The board's change cursor: the newest lane verb in the audit log, and the newest submission.
 *
 * Why the audit log rather than the board itself: lane state lives only in lane verb rows, so their
 * newest id is the board's own change journal, while building a fingerprint by re-reading the board
 * would cost the board read. Why the newest submission travels beside it: a new arrival moves the
 * waiting counts a card shows, and no lane verb records it.
 */
async function readLaneBoardCursor(): Promise<string> {
  const [laneRow, newestSubmission] = await Promise.all([
    prisma.audit_log.findFirst({
      where: { entity: 'submission', verb: { in: [...LANE_VERBS] } },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
    prisma.submissions.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }),
  ]);
  return `${laneRow === null ? '' : laneRow.id}:${newestSubmission === null ? '' : newestSubmission.id}`;
}

/**
 * The lane board's push channel: the board reloads its own read model when a lane assignment or move
 * is recorded, or when a submission joins the queue.
 */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['evaluation:list'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readLaneBoardCursor() }) }],
    })(connection),
});
