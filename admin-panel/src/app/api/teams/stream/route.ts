import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { readAuditEntityCursor } from '@/lib/live/cursors';
import { cursorFrameFingerprint, type CursorFrame } from '@/lib/live/frames';
import { LIST_CURSOR_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The teams list's push channel: the newest audited team write, so the list reloads when a team is
 * created, changed or removed.
 */
export const GET = createLiveStreamRoute<CursorFrame>({
  permissions: ['team:list'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<CursorFrame>({
      initial: { cursor: null },
      fingerprint: cursorFrameFingerprint,
      tracks: [{ intervalMs: LIST_CURSOR_POLL_MS, read: async () => ({ cursor: await readAuditEntityCursor('team') }) }],
    })(connection),
});
