import { collectWorkerStats } from '@/lib/worker-stats';
import { createLiveStreamRoute } from '@/lib/live/stream-route';
import { polledSource } from '@/lib/live/polled-source';
import { workersFrameFingerprint, type WorkersFrame } from '@/lib/live/frames';
import { DEPLOY_WORKERS_POLL_MS } from '@/lib/constants/live-stream';

export const dynamic = 'force-dynamic';

/**
 * The deployments panel's push channel: every worker node with its live reading.
 *
 * Why the gate is `task:read`: that is the key the panel's own worker read demands, and viewing
 * worker health is an operator concern while managing the fleet stays anchored in the save action.
 */
export const GET = createLiveStreamRoute<WorkersFrame>({
  permissions: ['task:read'],
  heartbeat: 'restate',
  source: (connection) =>
    polledSource<WorkersFrame>({
      initial: { workers: [] },
      fingerprint: workersFrameFingerprint,
      tracks: [{ intervalMs: DEPLOY_WORKERS_POLL_MS, read: async () => ({ workers: await collectWorkerStats() }) }],
    })(connection),
});
