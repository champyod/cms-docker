import fs from 'fs';
import net from 'net';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { getRepoRoot } from './repo-root';

const execPromise = util.promisify(exec);

// Why 2s: matches the emitter's per-probe budget (`timeout 2` in
// scripts/__worker_status_json.sh) so both surfaces agree on reachability.
const REMOTE_PROBE_TIMEOUT_MS = 2000;

export function probeReachable(host: string, port: number, timeoutMs: number = REMOTE_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (!host || !Number.isInteger(port) || port <= 0) {
      resolve(false);
      return;
    }
    const socket = new net.Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

export interface WorkerStat {
  id: string;
  name: string;
  status: string;
  tasks: number;
  load: number;
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

async function describeConfiguredWorker(
  worker: ConfiguredWorker,
  shardCounts: Record<number, number>,
  running: RunningShard[]
): Promise<WorkerStat> {
  const taskCount = shardCounts[worker.shard] || 0;
  // Why probe container-absent shards: remote workers have no local docker
  // entry, so docker-ps-only truth renders working remotes offline. A present
  // but exited container stays offline (crashed local); only absent shards
  // fall through to the reachability probe, so real outages still read offline.
  const entry = running.find((r) => r.shard === worker.shard);
  const containerUp = entry !== undefined && entry.status.toLowerCase().includes('up');
  const isLive = containerUp || (entry === undefined && (await probeReachable(worker.host, worker.port)));

  return {
    id: `worker-${worker.shard}`,
    name: `${worker.host}:${worker.port}`,
    status: isLive ? (taskCount > 0 ? 'busy' : 'online') : 'offline',
    tasks: taskCount,
    load: taskCount > 0 ? Math.min(100, (taskCount / 10) * 100) : 0
  };
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
      load: tasks ? Math.min(100, (tasks / 10) * 100) : 0
    };
  });
}

export async function collectWorkerStats(): Promise<WorkerStat[]> {
  try {
    const configuredWorkers = loadConfiguredWorkers(path.join(getRepoRoot(), '.env'));

    const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');

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

    const running: RunningShard[] = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status] = line.split('\t');
        return { shard: parseContainerShard(name) ?? -1, status };
      });

    if (configuredWorkers.length > 0) {
      return Promise.all(configuredWorkers.map((worker) => describeConfiguredWorker(worker, shardCounts, running)));
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
