'use server';

import fs from 'fs/promises';
import path from 'path';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { loadConfiguredWorkers } from '@/lib/worker-stats';
import { recordAudit } from '@/lib/audit';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { runConfigSync } from '@/lib/deploy-config';
import { upsertTomlValue } from '@/lib/discord-webhook';

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/;

// The fleet lives in config.toml's [worker] section as `WORKER_<n> = "host:port"` rows: the file
// scripts/__config_sync.sh renders .env from and scripts/__inject_config.sh then turns into the
// cms.toml Worker array the services read. cms.toml itself is generated — a write there is
// erased by the next sync.
const WORKER_SECTION = 'worker';
const WORKER_KEY_RE = /^\s*WORKER_\d+\s*=/;

type WorkerEntry = { host: string; port: number };

/** Whether a line opens a TOML section, bounding the section a key of ours lives in. */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']');
}

/**
 * Drops the fleet keys of the [worker] section.
 *
 * Why the keys are stripped before they are written: `upsertTomlValue` only sets a key, so a
 * worker the operator removed would survive as a stale `WORKER_<n>` row and reappear on the next
 * read. The rows are positional (`WORKER_0`..`WORKER_<n-1>`), so the whole set is rewritten.
 */
function stripWorkerKeys(content: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${WORKER_SECTION}]`);
  if (start === -1) return content;

  const nextHeader = lines.findIndex((line, index) => index > start && isSectionHeader(line));
  const end = nextHeader === -1 ? lines.length : nextHeader;
  return lines.filter((line, index) => index <= start || index >= end || !WORKER_KEY_RE.test(line)).join('\n');
}

/** config.toml carrying the fleet the operator holds, one positional key per worker. */
function renderWorkerFleet(content: string, workers: WorkerEntry[]): string {
  return workers.reduce(
    (accumulated, worker, shard) =>
      upsertTomlValue(accumulated, WORKER_SECTION, `WORKER_${shard}`, `${worker.host}:${worker.port}`),
    stripWorkerKeys(content),
  );
}

/** The configured worker endpoints and the fault that emptied them, if any. */
export interface WorkerConfigRead {
  readonly workers: WorkerEntry[];
  readonly error: string | null;
}

export async function getWorkers(): Promise<WorkerConfigRead> {
  await ensurePermission('settings:read');
  await ensurePermission('settings:list');

  // Why this reader and not a parse of its own: the fleet has one source, so the endpoints the
  // operator edits here and the readings the panel joins them to are the same shards.
  const fleet = await loadConfiguredWorkers(getRepoRoot());
  const workers: WorkerEntry[] = fleet.workers.map(({ host, port }) => ({ host, port }));
  const error = workers.length === 0 && fleet.unreadable.length > 0
    ? `Worker configuration could not be read: ${fleet.unreadable.join(', ')}`
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

/**
 * Writes the fleet the panel holds into the file the deployment installs it from.
 *
 * Why this file and not config/cms.toml: the sync regenerates cms.toml's Worker array from .env
 * on every deploy, so a write there survives only until the next sync, and the panel's own reader
 * never looks at it — the edit was invisible to the read that followed it.
 */
export async function updateWorkers(workers: WorkerEntry[]): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('settings:update');

  const invalidEntries = findInvalidWorkerEntries(workers);
  if (invalidEntries.length > 0) {
    return { success: false, error: `Invalid hostnames or ports: ${invalidEntries.join(', ')}` };
  }

  const configPath = path.join(getRepoRoot(), CONFIG_TOML_FILE);
  try {
    const previous = await loadConfiguredWorkers(getRepoRoot());
    const content = await fs.readFile(configPath, 'utf-8');
    await fs.writeFile(configPath, renderWorkerFleet(content, workers));
    // Why the sync and not a write to the render: the .env is generated from config.toml, so
    // editing it here is erased by the next sync and the operator's edit would not be live.
    await runConfigSync();
    await recordAudit({
      verb: 'settings:update',
      entity: 'worker_config',
      beforeValues: { workers: previous.workers.map(({ host, port }) => ({ host, port })) },
      afterValues: { workers },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to update workers', error);
    return { success: false, error: `Failed to write ${CONFIG_TOML_FILE} or regenerate its render` };
  }
}
