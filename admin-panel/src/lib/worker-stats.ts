import fs from 'fs';
import path from 'path';
import { exec, execFile } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { getRepoRoot } from './repo-root';

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// Why 12s: the emitter probes shards sequentially (2s each worst case), so a
// tick must never stack overlapping runs on the 5s summary interval.
const EMITTER_TIMEOUT_MS = 12000;
const EMITTER_SCRIPT = ['scripts', '__worker_status_json.sh'];

export interface WorkerStat {
  id: string;
  name: string;
  status: string;
  tasks: number;
  load: number;
  activity: string;
  health: string;
}

interface EmitterRow {
  shard?: unknown;
  endpoint?: unknown;
  state?: unknown;
  health?: unknown;
  activity?: unknown;
  reachable?: unknown;
}

type ConfiguredWorker = { shard: number; host: string; port: number };
type RunningShard = { shard: number; status: string };

const WORKER_ENV_LINE_RE = /^(?:export\s+)?WORKER_(\d+)\s*=\s*['"]?([^:'"]+)['"]?\s*:\s*(\d+)\s*$/;

function parseEnvCoreWorkerLine(line: string): ConfiguredWorker | null {
  const match = line.match(WORKER_ENV_LINE_RE);
  if (!match) return null;

  return {
    shard: parseInt(match[1], 10),
    host: match[2].trim(),
    port: parseInt(match[3], 10)
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

function isShardRunning(running: RunningShard[], shard: number): boolean {
  return running.some((r) => r.shard === shard && r.status.toLowerCase().includes('up'));
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function mapEmitterRowsToStats(rows: EmitterRow[], shardCounts: Record<number, number>): WorkerStat[] {
  return rows.map((row, index) => {
    const shard = typeof row.shard === 'number' ? row.shard : index;
    const taskCount = shardCounts[shard] || 0;
    const state = textOf(row.state, 'unknown');
    // Why reachable rescues absent: remote shards have no local container, so
    // docker-only truth renders working remotes offline. Exited stays offline
    // even if reachable; unreachable stays offline — real outages stay visible.
    const isLive = state === 'running' || (state === 'absent' && row.reachable === true);
    return {
      id: `worker-${shard}`,
      name: textOf(row.endpoint, `worker-${shard}`),
      status: isLive ? (taskCount > 0 ? 'busy' : 'online') : 'offline',
      tasks: taskCount,
      load: taskCount > 0 ? Math.min(100, (taskCount / 10) * 100) : 0,
      activity: textOf(row.activity, 'unknown'),
      health: textOf(row.health, 'none'),
    };
  });
}

async function loadEmitterRows(): Promise<EmitterRow[]> {
  const { stdout } = await execFilePromise(
    'bash',
    [path.join(getRepoRoot(), ...EMITTER_SCRIPT)],
    { cwd: getRepoRoot(), timeout: EMITTER_TIMEOUT_MS }
  );
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as EmitterRow[]) : [];
}

function parseContainerShard(name: string): number | null {
  const m = name.match(/cms-worker-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function describeContainerWorkers(containerLines: string[], shardCounts: Record<number, number>): WorkerStat[] {
  return containerLines.map((line) => {
    const [name, status] = line.split('\t');
    const isRunning = status.toLowerCase().includes('up');
    const shard = parseContainerShard(name);
    const tasks = shard !== null ? (shardCounts[shard] || 0) : 0;

    return {
      id: name,
      name: name,
      status: isRunning ? (tasks > 0 ? 'busy' : 'online') : 'offline',
      tasks,
      load: tasks ? Math.min(100, (tasks / 10) * 100) : 0,
      activity: 'unknown',
      health: 'none',
    };
  });
}

async function loadShardCounts(): Promise<Record<number, number>> {
  // Open evaluations per shard — the real busy/backlog signal.
  const groups = await prisma.evaluations.groupBy({
    by: ['evaluation_shard'],
    where: { outcome: null },
    _count: { _all: true }
  });
  const shardCounts: Record<number, number> = {};
  for (const g of groups) {
    if (g.evaluation_shard !== null) shardCounts[g.evaluation_shard] = g._count._all;
  }
  return shardCounts;
}

export async function collectWorkerStats(): Promise<WorkerStat[]> {
  try {
    const shardCounts = await loadShardCounts();
    try {
      // Why the emitter first: it is the single service that pings every
      // fleet shard (local docker state + TCP reachability incl. remotes).
      return mapEmitterRowsToStats(await loadEmitterRows(), shardCounts);
    } catch (emitterError) {
      console.error('Emitter failed, falling back to docker ps:', emitterError);
    }

    const configuredWorkers = loadConfiguredWorkers(path.join(getRepoRoot(), '.env'));

    const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');

    const running: RunningShard[] = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status] = line.split('\t');
        return { shard: parseContainerShard(name) ?? -1, status };
      });

    if (configuredWorkers.length > 0) {
      return configuredWorkers.map((worker) => {
        const tasks = shardCounts[worker.shard] || 0;
        const live = isShardRunning(running, worker.shard);
        return {
          id: `worker-${worker.shard}`,
          name: `${worker.host}:${worker.port}`,
          status: live ? (tasks > 0 ? 'busy' : 'online') : 'offline',
          tasks,
          load: tasks > 0 ? Math.min(100, (tasks / 10) * 100) : 0,
          activity: 'unknown',
          health: 'none',
        };
      });
    }

    if (!stdout.trim()) {
      return [];
    }

    return describeContainerWorkers(stdout.trim().split('\n'), shardCounts);
  } catch (error) {
    console.error('Failed to get worker stats:', error);
    return [];
  }
}
