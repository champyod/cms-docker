'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { readConfigFile } from '@/lib/config-file';
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

type WorkerEntry = { host: string; port: number };

/** The endpoints one source declares, and the refusal when it exists but could not be read. */
interface WorkerSource {
  readonly workers: WorkerEntry[];
  readonly unreadable: string[];
}

/** One source's endpoints: cms.toml's Worker block first, then the generated WORKER_n rows. */
async function parseWorkerSource(filePath: string): Promise<WorkerSource> {
  const read = await readConfigFile(filePath);
  if (read.kind === 'unreadable') return { workers: [], unreadable: [read.reason] };
  if (read.kind === 'absent') return { workers: [], unreadable: [] };
  const workerBlock = extractWorkerBlock(read.content);
  if (workerBlock) {
    const workers = parseWorkersFromBlock(workerBlock);
    if (workers.length > 0) return { workers, unreadable: [] };
  }
  return { workers: parseWorkersFromEnvCore(read.content), unreadable: [] };
}

/**
 * The worker endpoints, taken from cms.toml when it declares any and from the generated env file
 * otherwise. WHY the refusals travel with the endpoints: a source that exists but cannot be read
 * is not an empty source, and reporting only its absence renders a permission problem as none.
 */
async function readWorkerEndpoints(configPath: string | null): Promise<WorkerSource> {
  const unreadable: string[] = [];
  const candidates = [...(configPath === null ? [] : [configPath]), path.join(getRepoRoot(), '.env')];
  for (const candidate of candidates) {
    const source = await parseWorkerSource(candidate);
    unreadable.push(...source.unreadable);
    if (source.workers.length > 0) return { workers: source.workers, unreadable };
  }
  return { workers: [], unreadable };
}

/** The configured worker endpoints and the fault that emptied them, if any. */
export interface WorkerConfigRead {
  readonly workers: WorkerEntry[];
  readonly error: string | null;
}

export async function getWorkers(): Promise<WorkerConfigRead> {
  await ensurePermission('settings:read');
  await ensurePermission('settings:list');

  const { workers, unreadable } = await readWorkerEndpoints(await getCmsConfigPath());
  const error = workers.length === 0 && unreadable.length > 0
    ? `Worker configuration could not be read: ${unreadable.join(', ')}`
    : null;

  // Why count and not the endpoints: these are the deployment's internal hosts and ports, and
  // an audit table is the wrong place to keep them. The row answers who asked and how much
  // the request revealed, which is what a later disclosure has to be weighed against.
  try {
    await recordAudit({
      verb: 'worker_config:view',
      entity: 'worker_config',
      afterValues: { count: workers.length },
      result: error === null ? 'success' : 'failure',
    });
  } catch (auditError) {
    console.error('Failed to record the worker configuration view', auditError);
  }
  return { workers, error };
}

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
