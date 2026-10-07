import { verifyApiPermission } from '@/lib/api-utils';
import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { collectContainers, collectContainerRestartCount } from '@/lib/container-probes';
import { readContainerRestartConfig } from '@/lib/container-restart-store';
import { containersFrameFingerprint, type ContainersFrame } from '@/lib/live-frames';
import { CONTAINERS_POLL_MS, LIVE_HEARTBEAT_MS, LIVE_STREAM_HEADERS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The container page's one push channel: the container list, its restart counts and its restart config.
 *
 * Why the connection is gated on the page's own permission and the payload on `container:read`: a
 * viewer who may open the page but not read container details used to get an empty table, and must
 * keep getting one rather than start receiving names the actions would have refused them.
 */
export async function GET(): Promise<Response> {
  const { authorized, response, session } = await verifyApiPermission('container:list');
  if (!authorized) return response;

  const effective = await getFreshPermissions(session.userId);
  const canReadContainers = effective !== null && hasEffectivePermission(effective, 'container:read');

  const encoder = new TextEncoder();
  let frame: ContainersFrame = {};
  let fingerprint = containersFrameFingerprint(frame);
  let sentOnce = false;
  let closed = false;
  let inFlight = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stopTimers = (): void => {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const push = (force: boolean): void => {
        if (closed) return;
        const next = containersFrameFingerprint(frame);
        // Why the first frame always goes out: it is how the client learns the channel is up and the
        // table leaves its loading state, whatever the snapshot happens to contain. After that, only a
        // change or the heartbeat below produces a frame.
        if (!force && sentOnce && next === fingerprint) return;
        fingerprint = next;
        sentOnce = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      const fail = (): void => {
        stopTimers();
        if (closed) return;
        closed = true;
        controller.close();
      };

      /**
       * One pass over docker and the restart config.
       *
       * Why skipping rather than queueing when a pass is still running: `docker inspect` per container
       * can outlast the interval, and a queued pass would overlap the one already reading.
       */
      const collect = async (): Promise<void> => {
        if (inFlight || closed) return;
        inFlight = true;
        try {
          if (canReadContainers) {
            const containers = await collectContainers();
            const restartCounts: Record<string, number> = {};
            // Sequential on purpose: this mirrors the per-container calls the page used to make, and
            // one docker inspect at a time is gentler on the daemon than a burst of them.
            for (const container of containers) {
              restartCounts[container.id] = await collectContainerRestartCount(container.id);
            }
            frame = { ...frame, containers, restartCounts, config: await readContainerRestartConfig() };
          }
        } catch {
          fail();
        } finally {
          inFlight = false;
        }
      };

      pollTimer = setInterval(() => { void collect().then(() => push(false)); }, CONTAINERS_POLL_MS);
      heartbeatTimer = setInterval(() => { if (sentOnce) push(true); }, LIVE_HEARTBEAT_MS);

      await collect();
      push(true);
    },
    cancel() {
      closed = true;
      stopTimers();
    },
  });

  return new Response(stream, { headers: LIVE_STREAM_HEADERS });
}
