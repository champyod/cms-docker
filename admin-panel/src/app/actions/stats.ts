'use server';

import os from 'os';
import fs from 'fs';
import { ensurePermission } from '@/lib/permissions';
import { collectWorkerStats } from '@/lib/worker-stats';

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

export async function getWorkerStats(): Promise<ReturnType<typeof collectWorkerStats>> {
  await ensurePermission('all');
  return collectWorkerStats();
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
