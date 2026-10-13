import fs from 'fs';
import path from 'path';
import { exec, execFile } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { getRepoRoot } from './repo-root';
import {
  LAGGING_TASK_THRESHOLD,
  mapEmitterRowsToNodes,
  workerLoad,
  type EmitterWorkerRow,
  type WorkerNodeView,
} from './worker-nodes';

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// Why 12s: the emitter probes shards sequentially (2s each worst case), so a
// tick must never stack overlapping runs on the 5s summary interval.
const EMITTER_TIMEOUT_MS = 12000;
const EMITTER_SCRIPT = ['scripts', '__worker_status_json.sh'];

type ConfiguredWorker = { shard: number; host: string; port: number };

const WORKER_ENV_LINE_RE = /^(?:export\s+)?WORKER_(\d+)\s*=\s*['"]?([^:'"]+)['"]?\s*:\s*(\d+)\s*$/;

function parseEnvCoreWorkerLine(line: string): ConfiguredWorker | null {
  const match = line.match(WORKER_ENV_LINE_RE);
  if (!match) return null;

  return {
    shard: parseInt(match[1], 10),
    host: match[2].trim(),
    port: parseInt(match[3], 10),
  };
}

function loadConfiguredWorkers(envCorePath: string): ConfiguredWorker[] {
  try {
    return fs.readFileSync(envCorePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(parseEnvCoreWorkerLine)
      .filter((worker): worker is ConfiguredWorker => worker !== null)
      .sort((a, b) => a.shard - b.shard);
  } catch {
    return [];
  }
}

async function loadEmitterRows(): Promise<EmitterWorkerRow[]> {
  const { stdout } = await execFilePromise(
    'bash',
    [path.join(getRepoRoot(), ...EMITTER_SCRIPT)],
    { cwd: getRepoRoot(), timeout: EMITTER_TIMEOUT_MS }
  );
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as EmitterWorkerRow[]) : [];
}

async function loadShardCounts(): Promise<Record<number, number>> {
  // Open evaluations per shard — the real busy/backlog signal.
  const groups = await prisma.evaluations.groupBy({
    by: ['evaluation_shard'],
    where: { outcome: null },
    _count: { _all: true },
  });
  const shardCounts: Record<number, number> = {};
  for (const group of groups) {
    if (group.evaluation_shard !== null) shardCounts[group.evaluation_shard] = group._count._all;
  }
  return shardCounts;
}

interface LocalNodeInput {
  id: string;
  host: string;
  port: number;
  shard: number | null;
  endpoint: string;
  running: boolean;
  state: string;
  shardCounts: Record<number, number>;
}

/** A node the local docker daemon can see; the emitter's fallback when it is unreachable. */
function localNodeView({ id, host, port, shard, endpoint, running, state, shardCounts }: LocalNodeInput): WorkerNodeView {
  const tasks = shard !== null ? (shardCounts[shard] ?? 0) : 0;
  return {
    id,
    host,
    port,
    shard,
    endpoint,
    connection: running ? (tasks > 0 ? 'busy' : 'connected') : 'disconnected',
    state,
    health: 'none',
    activity: 'unknown',
    reachable: running,
    tasks,
    load: workerLoad(tasks),
    lagging: tasks >= LAGGING_TASK_THRESHOLD,
    contest: null,
    uptime: '',
    restarts: 0,
    lastLog: '',
  };
}

function parseContainerShard(name: string): number | null {
  const match = name.match(/cms-worker-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function collectFromDocker(shardCounts: Record<number, number>): Promise<WorkerNodeView[]> {
  const configured = loadConfiguredWorkers(path.join(getRepoRoot(), '.env'));
  const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');
  const lines = stdout.trim() ? stdout.trim().split('\n') : [];

  if (configured.length > 0) {
    return configured.map((worker) => localNodeView({
      id: `worker-${worker.shard}`,
      host: worker.host,
      port: worker.port,
      shard: worker.shard,
      endpoint: `${worker.host}:${worker.port}`,
      running: lines.some((line) => {
        const [name, status] = line.split('\t');
        return parseContainerShard(name) === worker.shard && status.toLowerCase().includes('up');
      }),
      state: 'running',
      shardCounts,
    }));
  }

  return lines.filter(Boolean).map((line) => {
    const [name, status] = line.split('\t');
    const running = status.toLowerCase().includes('up');
    const shard = parseContainerShard(name);
    return localNodeView({
      id: name,
      host: name,
      port: 0,
      shard,
      endpoint: name,
      running,
      state: running ? 'running' : 'exited',
      shardCounts,
    });
  });
}

/**
 * Every configured worker node with its live reading.
 *
 * Why the emitter first: it is the single service that pings every fleet shard —
 * local docker state plus TCP reachability, remotes included. The docker pass is
 * only the fallback for a host where the emitter itself cannot run.
 */
export async function collectWorkerStats(): Promise<WorkerNodeView[]> {
  try {
    const shardCounts = await loadShardCounts();
    try {
      return mapEmitterRowsToNodes(await loadEmitterRows(), shardCounts);
    } catch (emitterError) {
      console.error('Emitter failed, falling back to docker ps:', emitterError);
    }
    return await collectFromDocker(shardCounts);
  } catch (error) {
    console.error('Failed to get worker stats:', error);
    return [];
  }
}
