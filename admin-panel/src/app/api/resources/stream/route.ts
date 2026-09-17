import { verifyApiPermission } from '@/lib/api-utils';
import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { collectServerStats } from '@/lib/server-stats';
import { collectWorkerStats } from '@/lib/worker-stats';
import { collectCoreServicesStatus, collectNetworkTrafficLogs } from '@/lib/container-probes';
import { resourceFrameFingerprint, type ResourceFrame } from '@/lib/live-frames';
import {
  LIVE_HEARTBEAT_MS,
  LIVE_STREAM_HEADERS,
  RESOURCE_SERVER_POLL_MS,
  RESOURCE_SUMMARY_POLL_MS,
  TRAFFIC_LOG_LIMIT_DEFAULT,
  TRAFFIC_LOG_LIMIT_OPTIONS,
} from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/** Why the request is checked against the list the UI offers: the traffic table has no other page size. */
function parseTrafficLimit(request: Request): number {
  const raw = Number(new URL(request.url).searchParams.get('trafficLimit'));
  return TRAFFIC_LOG_LIMIT_OPTIONS.includes(raw) ? raw : TRAFFIC_LOG_LIMIT_DEFAULT;
}

/**
 * The resource page's one push channel: host counters, worker nodes, core services and container traffic.
 *
 * Why sections are gated separately rather than the whole stream on one key: the page they feed is
 * gated on `resource:list`, while each card behind it used to demand its own permission from its own
 * action. Resolving that once per connection keeps what each viewer may see identical to before —
 * a section they may not read is simply left out, and the card keeps whatever it last showed.
 */
export async function GET(request: Request): Promise<Response> {
  const { authorized, response, session } = await verifyApiPermission('resource:list');
  if (!authorized) return response;

  const effective = await getFreshPermissions(session.userId);
  const scope = {
    stats: effective !== null && hasEffectivePermission(effective, 'all:all'),
    services: effective !== null && hasEffectivePermission(effective, 'service:read'),
    traffic: effective !== null && hasEffectivePermission(effective, 'container:read'),
  };
  const trafficLimit = parseTrafficLimit(request);

  const encoder = new TextEncoder();
  let frame: ResourceFrame = {};
  let fingerprint = resourceFrameFingerprint(frame);
  let sentOnce = false;
  let closed = false;
  let statsInFlight = false;
  let summaryInFlight = false;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let summaryTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Why the timers live out here: a client that goes away must take its sampling with it, or every
  // abandoned connection keeps reading /proc and running docker forever.
  const stopTimers = (): void => {
    if (statsTimer !== null) clearInterval(statsTimer);
    if (summaryTimer !== null) clearInterval(summaryTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    statsTimer = null;
    summaryTimer = null;
    heartbeatTimer = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const push = (force: boolean): void => {
        if (closed) return;
        const next = resourceFrameFingerprint(frame);
        // Why the first frame always goes out: it is how the client learns the channel is up and the
        // page leaves its loading state, whatever the snapshot happens to contain. After that, only a
        // change or the heartbeat below produces a frame.
        if (!force && sentOnce && next === fingerprint) return;
        fingerprint = next;
        sentOnce = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };

      // Ends the stream rather than the page: the client notices and comes back on its own backoff.
      const fail = (): void => {
        stopTimers();
        if (closed) return;
        closed = true;
        controller.close();
      };

      /**
       * Host counters and worker nodes.
       *
       * Why skipping rather than queueing when a pass is still running: two overlapping passes would
       * interleave into the same frame, and a pass slow enough to overlap is not worth a second one.
       */
      const collectStats = async (): Promise<void> => {
        if (statsInFlight || closed) return;
        statsInFlight = true;
        try {
          if (scope.stats) {
            frame = { ...frame, server: await collectServerStats(), workers: await collectWorkerStats() };
          }
        } catch {
          fail();
        } finally {
          statsInFlight = false;
        }
      };

      const collectSummary = async (): Promise<void> => {
        if (summaryInFlight || closed) return;
        summaryInFlight = true;
        try {
          if (scope.services) {
            const services = await collectCoreServicesStatus();
            // Why a failed probe drops the section instead of repeating the last one: the frame says
            // what was readable, and the panel keeps its own last reading on screen either way. A
            // repeated section would instead present stale numbers as a fresh sample.
            frame = { ...frame, services: services.success ? services.services : undefined };
          }
          if (scope.traffic) {
            const traffic = await collectNetworkTrafficLogs(trafficLimit);
            frame = { ...frame, traffic: traffic.success ? traffic.logs : undefined };
          }
        } catch {
          fail();
        } finally {
          summaryInFlight = false;
        }
      };

      statsTimer = setInterval(() => { void collectStats().then(() => push(false)); }, RESOURCE_SERVER_POLL_MS);
      summaryTimer = setInterval(() => { void collectSummary().then(() => push(false)); }, RESOURCE_SUMMARY_POLL_MS);
      // Why the heartbeat waits for a snapshot: every frame is a full state, and before the first one
      // there is nothing to restate for the client's watchdog.
      heartbeatTimer = setInterval(() => { if (sentOnce) push(true); }, LIVE_HEARTBEAT_MS);

      // Why both halves are collected before the first send: the opening frame is the whole page, not
      // half of it followed by the other half a moment later.
      await collectStats();
      await collectSummary();
      push(true);
    },
    cancel() {
      closed = true;
      stopTimers();
    },
  });

  return new Response(stream, { headers: LIVE_STREAM_HEADERS });
}
