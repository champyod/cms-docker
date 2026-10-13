import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { readAuditEntityCursor } from '@/lib/live/cursors';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The users list's push channel: the newest audited user write, so the list re-reads its own page
 * when a user is created, changed or removed.
 */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['user:list'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readAuditEntityCursor('user') }) }],
    })(connection),
});
