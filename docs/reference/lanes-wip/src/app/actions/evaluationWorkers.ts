'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { callEvaluationRpc, unwrapRpcEnvelope } from '@/lib/evaluation-rpc';
import { readConfiguredWorkers } from '@/lib/worker-endpoints';

/** A worker as the lane board needs it: enough to label and pick one, no endpoint. */
export interface EvaluationWorkerSummary {
  readonly id: number;
  readonly shard: number;
  readonly name: string;
  readonly connected: boolean;
  readonly lastSeenAt: string | null;
}

/**
 * The shards the EvaluationService currently reports as connected, or null when it did not
 * answer.
 *
 * `workers_status` returns a dict keyed by shard whose values carry `connected`. A null
 * result means "unknown", never "none connected" — the caller must not turn a failed probe
 * into an offline verdict.
 */
async function readConnectedShards(): Promise<Set<number> | null> {
  const data = unwrapRpcEnvelope(await callEvaluationRpc('workers_status'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }

  const connected = new Set<number>();
  for (const [key, value] of Object.entries(data)) {
    const shard = Number(key);
    if (!Number.isInteger(shard)) continue;
    const entry = value as { connected?: unknown } | null;
    if (typeof entry === 'object' && entry !== null && entry.connected === true) {
      connected.add(shard);
    }
  }
  return connected;
}

/**
 * Bring the worker registry in line with the deployment and stamp liveness.
 *
 * WHY this writes on a read path: the registry holds no operator input — both halves are
 * projections of external truth (the generated config, and the live RPC), so refreshing it
 * crosses no authorization boundary. It is a cache of what the deployment already declares,
 * which is also why it writes no audit row; auditing belongs to the binding change, not the
 * refresh.
 *
 * WHY upsert rather than delete-and-recreate: a lane holds `worker_id`, and recreating rows
 * would null every binding on each refresh.
 *
 * WHY rows for removed workers survive: a worker dropped from config is marked disabled
 * instead of deleted, so a lane that referenced it keeps its binding and the removal is
 * visible rather than silent.
 */
export async function refreshEvaluationWorkers(): Promise<void> {
  await ensurePermission('evaluation:list');

  const configured = await readConfiguredWorkers();
  if (configured.length === 0) {
    return;
  }

  const connected = await readConnectedShards();
  const seenAt = new Date();

  for (const worker of configured) {
    const isConnected = connected?.has(worker.shard) ?? false;
    await prisma.evaluation_workers.upsert({
      where: { shard: worker.shard },
      create: {
        shard: worker.shard,
        name: worker.host,
        host: worker.host,
        port: worker.port,
        enabled: true,
        last_seen_at: isConnected ? seenAt : null,
      },
      update: {
        name: worker.host,
        host: worker.host,
        port: worker.port,
        enabled: true,
        ...(isConnected ? { last_seen_at: seenAt } : {}),
      },
    });
  }

  const configuredShards = configured.map((worker) => worker.shard);
  await prisma.evaluation_workers.updateMany({
    where: { shard: { notIn: configuredShards } },
    data: { enabled: false },
  });
}

/**
 * The registry as the board shows it.
 *
 * The host and port are deliberately not returned: they are the deployment's internal
 * endpoints, and the lane board only needs to label a worker and say whether it is live.
 */
export async function listEvaluationWorkers(): Promise<EvaluationWorkerSummary[]> {
  await ensurePermission('evaluation:list');

  const rows = await prisma.evaluation_workers.findMany({
    orderBy: { shard: 'asc' },
    select: { id: true, shard: true, name: true, last_seen_at: true },
  });

  return rows.map((row) => ({
    id: row.id,
    shard: row.shard,
    name: row.name,
    connected: row.last_seen_at !== null,
    lastSeenAt: row.last_seen_at === null ? null : row.last_seen_at.toISOString(),
  }));
}
