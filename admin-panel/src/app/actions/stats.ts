'use server';

import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';

const execPromise = util.promisify(exec);

export async function getServerStats() {
  await ensurePermission('all');
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  const uptime = os.uptime();

  // Percentage of used memory
  const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;

  // Simple CPU usage estimation from load average (1 min)
  const cpuUsage = (loadAvg[0] / cpus.length) * 100;

  // Network stats (reading from /proc/net/dev if on Linux)
  let networkStats = { rx: 0, tx: 0 };
  try {
    if (process.platform === 'linux') {
      const data = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = data.split('\n');
      // sum up all interfaces (ignoring lo)
      let totalRx = 0;
      let totalTx = 0;
      for (const line of lines) {
        if (line.includes(':') && !line.includes('lo:')) {
          const parts = line.trim().split(/\s+/);
          totalRx += parseInt(parts[1], 10);
          totalTx += parseInt(parts[9], 10);
        }
      }
      networkStats = { rx: totalRx, tx: totalTx };
    }
  } catch {
    console.warn('Could not read /proc/net/dev for network stats');
  }

  return {
    cpu: Math.min(100, Math.round(cpuUsage)),
    memory: Math.round(memoryUsage),
    uptime: formatUptime(uptime),
    network: networkStats,
    loadAvg: loadAvg.map(l => l.toFixed(2)),
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
    activeEvaluations.forEach((ev) => {
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
      return liveWorkerServices.some((service) => {
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
