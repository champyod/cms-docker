'use server';

import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { getSession } from '@/lib/auth';
import { collectWorkerStats } from '@/lib/worker-stats';
import type { WorkerNodeView } from '@/lib/worker-nodes';

/**
 * Every worker node with its live reading, gated for the deployments panel.
 *
 * Why this defers to collectWorkerStats: that is the one path that reaches both
 * local docker state and remote shards over TCP, so a remote node reads its real
 * connection instead of being mislabelled disconnected by a local-only probe.
 */
export async function getWorkersLiveStatus(): Promise<{
  forbidden: boolean;
  canManage: boolean;
  workers: WorkerNodeView[];
  error: string | null;
}> {
  const session = await getSession();
  if (!session) return { forbidden: true, canManage: false, workers: [], error: null };
  const fresh = await getFreshPermissions(session.userId);
  if (!fresh) return { forbidden: true, canManage: false, workers: [], error: null };

  // Viewing worker health is an operator concern (tasks); management stays superadmin.
  const canView = hasEffectivePermission(fresh, 'task:read');
  const canManage = hasEffectivePermission(fresh, 'all:all');
  if (!canView) return { forbidden: true, canManage, workers: [], error: null };

  const fleet = await collectWorkerStats();
  return { forbidden: false, canManage, workers: fleet.workers, error: fleet.error };
}
