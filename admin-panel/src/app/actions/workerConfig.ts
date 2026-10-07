'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/;

async function getCmsConfigPath() {
  const possiblePaths = [
    path.join(getRepoRoot(), 'config/cms.toml'),
    path.join(process.cwd(), 'config', 'cms.toml'),
    '/usr/local/etc/cms.toml'
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Probing candidate paths: absence of one location is expected, keep scanning
    }
  }
  return null;
}

function extractWorkerBlock(content: string): string | null {
  const keyIndex = content.search(/(^|\n)\s*Worker\s*=\s*\[/);
  if (keyIndex === -1) return null;

  const openIndex = content.indexOf('[', keyIndex);
  if (openIndex === -1) return null;

  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (depth === 0) {
      return content.slice(openIndex + 1, index);
    }
  }

  return null;
}

function parseWorkersFromBlock(block: string): Array<{ host: string; port: number }> {
  const workers: Array<{ host: string; port: number }> = [];
  const regex = /\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/g;

  let match = regex.exec(block);
  while (match !== null) {
    workers.push({ host: match[1], port: parseInt(match[2], 10) });
    match = regex.exec(block);
  }

  return workers;
}

function parseWorkersFromEnvCore(content: string): Array<{ host: string; port: number }> {
  const workers: Array<{ index: number; host: string; port: number }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^WORKER_(\d+)=(.+):(\d+)$/);
    if (!match) continue;

    workers.push({
      index: parseInt(match[1], 10),
      host: match[2],
      port: parseInt(match[3], 10)
    });
  }

  return workers
    .sort((a, b) => a.index - b.index)
    .map(({ host, port }) => ({ host, port }));
}

/**
 * The worker endpoints, taken from cms.toml's Worker block when it declares any and from the
 * generated env file otherwise. Kept separate from the audit call so the read reports one result
 * per request rather than one per candidate source.
 */
async function readWorkerEndpoints(configPath: string | null): Promise<WorkerEntry[]> {
  if (configPath) {
    const content = await fs.readFile(configPath, 'utf-8');
    const workerBlock = extractWorkerBlock(content);
    if (workerBlock) {
      const workers = parseWorkersFromBlock(workerBlock);
      if (workers.length > 0) return workers;
    }
  }

  const envCorePath = path.join(getRepoRoot(), '.env');
  const envCoreContent = await fs.readFile(envCorePath, 'utf-8');
  return parseWorkersFromEnvCore(envCoreContent);
}

export async function getWorkers() {
  await ensurePermission('settings:read');
  await ensurePermission('settings:list');

  const configPath = await getCmsConfigPath();

  try {
    const workers = await readWorkerEndpoints(configPath);
    // Why count and not the endpoints: these are the deployment's internal hosts and ports, and
    // an audit table is the wrong place to keep them. The row answers who asked and how much
    // the request revealed, which is what a later disclosure has to be weighed against.
    await recordAudit({
      verb: 'worker_config:view',
      entity: 'worker_config',
      afterValues: { count: workers.length },
      result: 'success',
    });
    return workers;
  } catch (error) {
    console.error('Failed to parse workers from cms.toml', error);
    await recordAudit({
      verb: 'worker_config:view',
      entity: 'worker_config',
      afterValues: { error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return [];
  }
}

type WorkerEntry = { host: string; port: number };

function findInvalidWorkerEntries(workers: WorkerEntry[]): string[] {
  const invalidEntries: string[] = [];

  for (const w of workers) {
    const validHost = typeof w.host === 'string' && HOST_RE.test(w.host);
    const validPort = Number.isInteger(w.port) && w.port >= 1 && w.port <= 65535;
    if (!validHost || !validPort) {
      invalidEntries.push(`${w.host}:${w.port}`);
    }
  }

  return invalidEntries;
}

function applyWorkerBlock(content: string, workers: WorkerEntry[]): string | null {
  if (!/Worker\s*=\s*\[[\s\S]*?\]/.test(content)) return null;

  const workerString = 'Worker = [\n' + workers.map(w => `    ["${w.host}", ${w.port}],`).join('\n') + '\n]';
  return content.replace(/Worker\s*=\s*\[[\s\S]*?\]/, workerString);
}

export async function updateWorkers(workers: { host: string; port: number }[]) {
  await ensurePermission('settings:update');

  const invalidEntries = findInvalidWorkerEntries(workers);
  if (invalidEntries.length > 0) {
    return { success: false, error: `Invalid hostnames or ports: ${invalidEntries.join(', ')}` };
  }

  const configPath = await getCmsConfigPath();
  if (!configPath) return { success: false, error: 'cms.toml not found' };

  try {
    const content = await fs.readFile(configPath, 'utf-8');

    const updated = applyWorkerBlock(content, workers);
    if (updated === null) {
      return { success: false, error: 'Worker configuration block not found in cms.toml' };
    }

    const previousBlock = extractWorkerBlock(content);
    const previousWorkers = previousBlock ? parseWorkersFromBlock(previousBlock) : [];
    await fs.writeFile(configPath, updated);
    await recordAudit({
      verb: 'settings:update',
      entity: 'worker_config',
      beforeValues: { workers: previousWorkers },
      afterValues: { workers },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to update workers', error);
    return { success: false, error: 'Failed to write cms.toml' };
  }
}
