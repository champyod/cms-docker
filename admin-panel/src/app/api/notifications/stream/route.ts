import { verifyApiPermission } from '@/lib/api-utils';
import { getRecent, subscribe, type QueuedNotification } from '@/lib/notification-queue';
import { LIVE_HEARTBEAT_MS, LIVE_STREAM_HEADERS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/** An empty frame the client drops (it carries no frame id); sent only to hold the connection open. */
const HEARTBEAT_FRAME = 'data: {}\n\n';

/** Numeric row id behind a stable `audit-<n>` frame id, or null. */
function frameRowId(id: string): number | null {
  const match = /^audit-(\d+)$/.exec(id);
  if (match === null) return null;
  const rowId = Number(match[1]);
  return Number.isFinite(rowId) ? rowId : null;
}

export async function GET(request: Request): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('audit:read');
  if (!authorized) return response;

  const since = Number(new URL(request.url).searchParams.get('since') ?? 0);
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    closed = true;
    unsubscribe?.();
    if (heartbeat !== null) clearInterval(heartbeat);
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (frame: string): void => {
        if (!closed) controller.enqueue(encoder.encode(frame));
      };
      const sendNotification = (frame: QueuedNotification): void => send(`data: ${JSON.stringify(frame)}\n\n`);
      for (const frame of getRecent()) {
        const rowId = frameRowId(frame.id);
        if (rowId === null || rowId > since) sendNotification(frame);
      }
      unsubscribe = subscribe(sendNotification);
      // Why a real frame and not an SSE comment: a comment never dispatches onmessage, so it could not hold the watchdog.
      heartbeat = setInterval(() => send(HEARTBEAT_FRAME), LIVE_HEARTBEAT_MS);
      request.signal.addEventListener('abort', () => {
        stop();
        controller.close();
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: LIVE_STREAM_HEADERS });
}
