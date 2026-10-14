import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { collectServerStats } from '@/lib/server-stats';
import { collectWorkerStats } from '@/lib/worker-stats';
import { collectCoreServicesStatus, collectNetworkTrafficLogs } from '@/lib/container-probes';
import { resourceFrameFingerprint, type ResourceFrame } from '@/lib/live-frames';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import {
  RESOURCE_SERVER_POLL_MS,
  RESOURCE_SUMMARY_POLL_MS,
  TRAFFIC_LOG_LIMIT_DEFAULT,
  TRAFFIC_LOG_LIMIT_OPTIONS,
} from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

interface ResourceScope {
  readonly stats: boolean;
  readonly services: boolean;
  readonly traffic: boolean;
}

/** Why the request is checked against the list the UI offers: the traffic table has no other page size. */
function parseTrafficLimit(request: Request): number {
  const raw = Number(new URL(request.url).searchParams.get('trafficLimit'));
  return TRAFFIC_LOG_LIMIT_OPTIONS.includes(raw) ? raw : TRAFFIC_LOG_LIMIT_DEFAULT;
}

/**
 * Why sections are gated separately from the connection: the page is gated on `resource:list`, while
 * each card behind it used to demand its own permission from its own action. Resolving that once per
 * connection keeps what each viewer may see identical to before — a section they may not read is left
 * out of every frame, and the card keeps whatever it last showed.
 */
async function readResourceScope(userId: string): Promise<ResourceScope> {
  const effective = await getFreshPermissions(userId);
  return {
    stats: effective !== null && hasEffectivePermission(effective, 'resource:read'),
    services: effective !== null && hasEffectivePermission(effective, 'service:read'),
    traffic: effective !== null && hasEffectivePermission(effective, 'container:read'),
  };
}

async function readStats(frame: ResourceFrame, scope: ResourceScope): Promise<ResourceFrame> {
  if (!scope.stats) return frame;
  const fleet = await collectWorkerStats();
  return { ...frame, server: await collectServerStats(), workers: fleet.workers };
}

async function readSummary(frame: ResourceFrame, scope: ResourceScope, trafficLimit: number): Promise<ResourceFrame> {
  const next = { ...frame };
  if (scope.services) {
    const services = await collectCoreServicesStatus();
    // Why a failed probe drops the section instead of repeating the last one: the frame says what was
    // readable, and the panel keeps its own last reading on screen either way. A repeated section would
    // instead present stale numbers as a fresh sample.
    next.services = services.success ? services.services : undefined;
  }
  if (scope.traffic) {
    const traffic = await collectNetworkTrafficLogs(trafficLimit);
    next.traffic = traffic.success ? traffic.logs : undefined;
  }
  return next;
}

/**
 * The resource page's one push channel: host counters, worker nodes, core services and container traffic.
 *
 * Why the counters are a track of their own: the page must not wait on the docker-backed summary to
 * leave its loading state, so the two are sampled on the cadences the page used to poll them at.
 */
export const GET = createLiveStreamRoute<ResourceFrame>({
  permissions: ['resource:list', 'resource:read'],
  heartbeat: 'restate',
  source: async (connection) => {
    const scope = await readResourceScope(connection.session.userId);
    const trafficLimit = parseTrafficLimit(connection.request);
    return polledSource<ResourceFrame>({
      initial: {},
      fingerprint: resourceFrameFingerprint,
      tracks: [
        { intervalMs: RESOURCE_SERVER_POLL_MS, read: (frame) => readStats(frame, scope) },
        { intervalMs: RESOURCE_SUMMARY_POLL_MS, read: (frame) => readSummary(frame, scope, trafficLimit) },
      ],
    })(connection);
  },
});
