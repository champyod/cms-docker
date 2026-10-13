import { getRecent, subscribe, type QueuedNotification } from '@/lib/notification-queue';
import { createLiveStreamRoute } from '@/lib/live/stream-route';

export const dynamic = 'force-dynamic';

/** Numeric row id behind a stable `audit-<n>` frame id, or null. */
function frameRowId(id: string): number | null {
  const match = /^audit-(\d+)$/.exec(id);
  if (match === null) return null;
  const rowId = Number(match[1]);
  return Number.isFinite(rowId) ? rowId : null;
}

/**
 * The alert bell's channel: the frames a freshly connected viewer is still missing, then every frame as
 * it is published.
 *
 * Why the replay is filtered by `since`: the stream reopens on every reconnect, and the client's cursor
 * is what keeps a focus toggle from re-alerting a row it has already shown.
 */
export const GET = createLiveStreamRoute<QueuedNotification>({
  permissions: ['audit:read'],
  heartbeat: 'empty',
  source: (connection) => {
    const since = Number(new URL(connection.request.url).searchParams.get('since') ?? 0);
    for (const frame of getRecent()) {
      const rowId = frameRowId(frame.id);
      if (rowId === null || rowId > since) connection.emit(frame);
    }
    return subscribe((frame) => connection.emit(frame));
  },
});
