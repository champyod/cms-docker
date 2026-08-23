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
type LiveWorkerService = { address: string; port: number; shard: number };

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

function countEvaluationsByShard(evaluations: Array<{ evaluation_shard: number | null }>): Record<number, number> {
  const shardCounts: Record<number, number> = {};
  evaluations.forEach((ev) => {
    if (ev.evaluation_shard !== null) {
      shardCounts[ev.evaluation_shard] = (shardCounts[ev.evaluation_shard] || 0) + 1;
    }
  });
  return shardCounts;
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function hostMatches(liveHost: string, targetHost: string): boolean {
  return liveHost === targetHost ||
    liveHost.includes(targetHost) ||
    targetHost.includes(liveHost) ||
    (targetHost === 'localhost' && liveHost === '127.0.0.1') ||
    (targetHost === '127.0.0.1' && liveHost === 'localhost');
}

function isWorkerServiceLive(services: LiveWorkerService[], host: string, port: number, shard: number): boolean {
  const targetHost = normalizeHost(host);
  return services.some((service) => {
    if (service.shard === shard) return true;
    if (service.port !== port) return false;
    return hostMatches(normalizeHost(service.address || ''), targetHost);
  });
}

function describeConfiguredWorker(
  worker: ConfiguredWorker,
  shardCounts: Record<number, number>,
  services: LiveWorkerService[]
): WorkerStat {
  const taskCount = shardCounts[worker.shard] || 0;
  const isLive = isWorkerServiceLive(services, worker.host, worker.port, worker.shard);

  return {
    id: `worker-${worker.shard}`,
    name: `${worker.host}:${worker.port}`,
    status: isLive ? (taskCount > 0 ? 'busy' : 'online') : 'offline',
    tasks: taskCount,
    load: taskCount > 0 ? Math.min(100, (taskCount / 10) * 100) : 0
  };
}

function describeContainerWorkers(containerLines: string[], shardCounts: Record<number, number>): WorkerStat[] {
  return containerLines.map((line, index) => {
    const [name, status] = line.split('\t');
    const isRunning = status.toLowerCase().includes('up');

    return {
      id: name,
      name: name,
      status: isRunning ? (shardCounts[index] > 0 ? 'busy' : 'online') : 'offline',
      tasks: shardCounts[index] || 0,
      load: shardCounts[index] ? Math.min(100, (shardCounts[index] / 10) * 100) : 0
    };
  });
}

export async function collectWorkerStats(): Promise<WorkerStat[]> {
  try {
    const configuredWorkers = loadConfiguredWorkers(path.join(getRepoRoot(), '.env.core'));

    // Get all cms-worker containers
    const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');

    // Get active evaluations per shard
    const activeEvaluations = await prisma.evaluations.findMany({
      where: { outcome: null },
      select: { evaluation_shard: true }
    });

    const shardCounts = countEvaluationsByShard(activeEvaluations);

    const liveWorkerServices = await prisma.$queryRaw<LiveWorkerService[]>`
      SELECT address, port, shard FROM services WHERE name = 'Worker' ORDER BY shard;
    `;

    if (configuredWorkers.length > 0) {
      return configuredWorkers.map((worker) => describeConfiguredWorker(worker, shardCounts, liveWorkerServices));
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
