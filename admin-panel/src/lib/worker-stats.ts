import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { getRepoRoot } from './repo-root';

const execPromise = util.promisify(exec);

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

function describeConfiguredWorker(
  worker: ConfiguredWorker,
  shardCounts: Record<number, number>,
  running: RunningShard[]
): WorkerStat {
  const taskCount = shardCounts[worker.shard] || 0;
  const isLive = isShardRunning(running, worker.shard);

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
    const configuredWorkers = loadConfiguredWorkers(path.join(getRepoRoot(), '.env.core'));

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
      return configuredWorkers.map((worker) => describeConfiguredWorker(worker, shardCounts, running));
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
