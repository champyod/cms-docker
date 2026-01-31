'use server';

import os from 'os';
import fs from 'fs';
import { prisma } from '@/lib/prisma';

export async function getServerStats() {
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
  } catch (error) {
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
  // Workers are configured in config/cms.toml, not in the database in this environment.
  // We avoid querying the non-existent 'workers' table.

  // Get active evaluations per shard
  const activeEvaluations = await prisma.evaluations.findMany({
    where: { outcome: null },
    select: { evaluation_shard: true }
  });

  // Group by shard
  const shardCounts: Record<number, number> = {};
  activeEvaluations.forEach((ev: any) => {
    if (ev.evaluation_shard !== null) {
      shardCounts[ev.evaluation_shard] = (shardCounts[ev.evaluation_shard] || 0) + 1;
    }
  });

  // Since we can't easily query the workers from DB, we'll just check if there are any active shards
  // Or simply return a placeholder indicating workers are managed via file.

  // Improving the fallback to be more informative
  return [{
    id: 'cms-toml',
    name: 'Workers (Managed in cms.toml)',
    status: Object.keys(shardCounts).length > 0 ? 'busy' : 'idle',
    tasks: Object.values(shardCounts).reduce((a, b) => a + b, 0),
    load: 0 // Cannot calculate load without capacity
  }];
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
