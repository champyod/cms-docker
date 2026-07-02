'use server';

import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';

const execPromise = util.promisify(exec);

type CpuSample = {
  idle: number;
  total: number;
};

let previousCpuSample: CpuSample | null = null;

function readTextFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseCpuSample(statLine: string): CpuSample | null {
  const parts = statLine.trim().split(/\s+/);
  if (parts.length < 8 || parts[0] !== 'cpu') return null;

  const user = Number(parts[1] || 0);
  const nice = Number(parts[2] || 0);
  const system = Number(parts[3] || 0);
  const idle = Number(parts[4] || 0);
  const iowait = Number(parts[5] || 0);
  const irq = Number(parts[6] || 0);
  const softirq = Number(parts[7] || 0);
  const steal = Number(parts[8] || 0);

  const idleTotal = idle + iowait;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;

  if (!Number.isFinite(idleTotal) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return { idle: idleTotal, total };
}

function computeCpuUsagePercent(current: CpuSample): number | null {
  if (!previousCpuSample) {
    previousCpuSample = current;
    return null;
  }

  const totalDelta = current.total - previousCpuSample.total;
  const idleDelta = current.idle - previousCpuSample.idle;
  previousCpuSample = current;

  if (totalDelta <= 0) return null;

  const usage = 100 * (1 - idleDelta / totalDelta);
  if (!Number.isFinite(usage)) return null;
  return Math.max(0, Math.min(100, Math.round(usage)));
}

function parseMemInfo(memInfoText: string): { total: number; available: number } | null {
  const lines = memInfoText.split('\n');
  let totalKb = 0;
  let availableKb = 0;

  for (const line of lines) {
    if (line.startsWith('MemTotal:')) {
      totalKb = Number(line.replace(/[^0-9]/g, ''));
    }
    if (line.startsWith('MemAvailable:')) {
      availableKb = Number(line.replace(/[^0-9]/g, ''));
    }
  }

  if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
  if (!Number.isFinite(availableKb) || availableKb < 0) availableKb = 0;
  return { total: totalKb * 1024, available: availableKb * 1024 };
}

function parseNetworkTotal(netDevText: string): { rx: number; tx: number } {
  const lines = netDevText.split('\n');
  let totalRx = 0;
  let totalTx = 0;

  for (const line of lines) {
    if (!line.includes(':') || line.includes('lo:')) continue;
    const parts = line.trim().split(/\s+/);
    const rx = Number(parts[1] || 0);
    const tx = Number(parts[9] || 0);
    if (Number.isFinite(rx)) totalRx += rx;
    if (Number.isFinite(tx)) totalTx += tx;
  }

  return { rx: totalRx, tx: totalTx };
}

function getProcBasePath(): '/host/proc' | '/proc' {
  if (fs.existsSync('/host/proc/stat') && fs.existsSync('/host/proc/meminfo')) {
    return '/host/proc';
  }
  return '/proc';
}

export async function getServerStats() {
  await ensurePermission('all');
  const procBase = getProcBasePath();

  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  const statText = readTextFileSafe(`${procBase}/stat`);
  const memInfoText = readTextFileSafe(`${procBase}/meminfo`);
  const netDevText = readTextFileSafe(`${procBase}/net/dev`);
  const uptimeText = readTextFileSafe(`${procBase}/uptime`);

  const parsedCpuSample = statText ? parseCpuSample(statText.split('\n')[0]) : null;
  const cpuUsageFromDelta = parsedCpuSample ? computeCpuUsagePercent(parsedCpuSample) : null;
  const cpuUsageFallback = (loadAvg[0] / Math.max(cpus.length, 1)) * 100;
  const cpuUsage = cpuUsageFromDelta ?? Math.min(100, Math.max(0, Math.round(cpuUsageFallback)));

  const parsedMem = memInfoText ? parseMemInfo(memInfoText) : null;
  const totalMem = parsedMem?.total ?? os.totalmem();
  const availableMem = parsedMem?.available ?? os.freemem();
  const memoryUsage = totalMem > 0 ? ((totalMem - availableMem) / totalMem) * 100 : 0;

  let uptime = os.uptime();
  if (uptimeText) {
    const uptimeSeconds = Number((uptimeText.trim().split(/\s+/)[0]) || 0);
    if (Number.isFinite(uptimeSeconds) && uptimeSeconds >= 0) {
      uptime = uptimeSeconds;
    }
  }

  const networkStats = netDevText ? parseNetworkTotal(netDevText) : { rx: 0, tx: 0 };

  return {
    cpu: Math.min(100, Math.round(cpuUsage)),
    memory: Math.round(memoryUsage),
    uptime: formatUptime(uptime),
    network: networkStats,
    loadAvg: loadAvg.map(l => l.toFixed(2)),
    source: procBase === '/host/proc' ? 'host' : 'container',
  };
}

export async function getWorkerStats() {
  await ensurePermission('all');
  try {
    const repoRoot = process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');
    const envCorePath = path.join(repoRoot, '.env.core');

    let configuredWorkers: Array<{ shard: number; host: string; port: number }> = [];
    try {
      const envCoreContent = fs.readFileSync(envCorePath, 'utf8');
      configuredWorkers = envCoreContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const match = line.match(/^(?:export\s+)?WORKER_(\d+)\s*=\s*['\"]?([^:'\"]+)['\"]?\s*:\s*(\d+)\s*$/);
          if (!match) return null;
          return {
            shard: parseInt(match[1], 10),
            host: match[2].trim(),
            port: parseInt(match[3], 10)
          };
        })
        .filter((worker): worker is { shard: number; host: string; port: number } => worker !== null)
        .sort((a, b) => a.shard - b.shard);
    } catch {
      configuredWorkers = [];
    }

    // Get all cms-worker containers
    const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');

    // Get active evaluations per shard
    const activeEvaluations = await prisma.evaluations.findMany({
      where: { outcome: null },
      select: { evaluation_shard: true }
    });

    // Group by shard
    const shardCounts: Record<number, number> = {};
    activeEvaluations.forEach((ev: { evaluation_shard: number | null }) => {
      if (ev.evaluation_shard !== null) {
        shardCounts[ev.evaluation_shard] = (shardCounts[ev.evaluation_shard] || 0) + 1;
      }
    });

    const liveWorkerServices = await prisma.$queryRaw<Array<{ address: string; port: number; shard: number }>>`
      SELECT address, port, shard FROM services WHERE name = 'Worker' ORDER BY shard;
    `;

    const normalizeHost = (value: string) => value.trim().toLowerCase();
    const isWorkerServiceLive = (host: string, port: number, shard: number) => {
      const targetHost = normalizeHost(host);
      return liveWorkerServices.some((service: { address: string; port: number; shard: number }) => {
        if (service.shard === shard) return true;

        if (service.port !== port) return false;
        const liveHost = normalizeHost(service.address || '');
        return liveHost === targetHost ||
          liveHost.includes(targetHost) ||
          targetHost.includes(liveHost) ||
          (targetHost === 'localhost' && liveHost === '127.0.0.1') ||
          (targetHost === '127.0.0.1' && liveHost === 'localhost');
      });
    };

    if (configuredWorkers.length > 0) {
      return configuredWorkers.map((worker) => {
        const taskCount = shardCounts[worker.shard] || 0;
        const isLive = isWorkerServiceLive(worker.host, worker.port, worker.shard);

        return {
          id: `worker-${worker.shard}`,
          name: `${worker.host}:${worker.port}`,
          status: isLive ? (taskCount > 0 ? 'busy' : 'online') : 'offline',
          tasks: taskCount,
          load: taskCount > 0 ? Math.min(100, (taskCount / 10) * 100) : 0
        };
      });
    }

    if (!stdout.trim()) {
      return [];
    }

    const workers = stdout.trim().split('\n').map((line, index) => {
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

    return workers;
  } catch (error) {
    console.error('Failed to get worker stats:', error);
    return [];
  }
}


function formatUptime(seconds: number) {
  const days = Math.floor(seconds / (24 * 3600));
  const hours = Math.floor((seconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.length > 0 ? parts.join(' ') : '0m';
}
