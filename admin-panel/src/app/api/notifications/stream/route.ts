import { verifyApiPermission } from '@/lib/api-utils';
import { getRecent, subscribe, type QueuedNotification } from '@/lib/notification-queue';

export const dynamic = 'force-dynamic';

/** Numeric row id behind a stable `audit-<n>` frame id, or null. */
function frameRowId(id: string): number | null {
  const match = /^audit-(\d+)$/.exec(id);
  if (match === null) return null;
  const rowId = Number(match[1]);
  return Number.isFinite(rowId) ? rowId : null;
}

export async function GET(request: Request): Promise<Response> {
  // Why audit:read with no exception: every frame derives from audit rows, so
  // the audit gate is the correct boundary.
  const { authorized, response } = await verifyApiPermission('audit:read');
  if (!authorized) return response;

  const url = new URL(request.url);
  const since = Number(url.searchParams.get('since') ?? 0);

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = (frame: QueuedNotification): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      for (const frame of getRecent()) {
        const rowId = frameRowId(frame.id);
        if (rowId !== null && rowId <= since) continue;
        push(frame);
      }
      unsubscribe = subscribe(push);
      request.signal.addEventListener('abort', () => {
        closed = true;
        unsubscribe?.();
        controller.close();
      });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
