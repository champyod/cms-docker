import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { collectContainers, collectContainerRestartCount } from '@/lib/container-probes';
import { readContainerRestartConfig } from '@/lib/container-restart-store';
import { containersFrameFingerprint, type ContainersFrame } from '@/lib/live-frames';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { CONTAINERS_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * Why the payload is gated separately from the connection: a viewer who may open the page but not read
 * container details used to get an empty table, and must keep getting one rather than start receiving
 * names the actions would have refused them.
 */
async function canReadContainers(userId: string): Promise<boolean> {
  const effective = await getFreshPermissions(userId);
  return effective !== null && hasEffectivePermission(effective, 'container:read');
}

async function readContainersSnapshot(frame: ContainersFrame, canRead: boolean): Promise<ContainersFrame> {
  if (!canRead) return frame;
  const containers = await collectContainers();
  const restartCounts: Record<string, number> = {};
  // Sequential on purpose: this mirrors the per-container calls the page used to make, and one docker
  // inspect at a time is gentler on the daemon than a burst of them.
  for (const container of containers) {
    restartCounts[container.id] = await collectContainerRestartCount(container.id);
  }
  return { ...frame, containers, restartCounts, config: await readContainerRestartConfig() };
}

/** The container page's one push channel: the container list, its restart counts and its restart config. */
export const GET = createLiveStreamRoute<ContainersFrame>({
  permissions: ['container:list'],
  heartbeat: 'restate',
  source: async (connection) => {
    const canRead = await canReadContainers(connection.session.userId);
    return polledSource<ContainersFrame>({
      initial: {},
      fingerprint: containersFrameFingerprint,
      tracks: [
        { intervalMs: CONTAINERS_POLL_MS, read: (frame) => readContainersSnapshot(frame, canRead) },
      ],
    })(connection);
  },
});
