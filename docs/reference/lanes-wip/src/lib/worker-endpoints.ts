import fs from 'fs/promises';
import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/**
 * One worker as declared by the deployment, in shard order.
 *
 * The shard is the index the CMS worker pool addresses a worker by: the pool is built
 * from `get_service_shards("Worker")` and each entry becomes `ServiceCoord("Worker", i)`,
 * so list position IS the shard. Nothing else in the configuration carries that identity,
 * which is why the registry stores it as the stable key rather than a name.
 */
export interface WorkerEndpoint {
  readonly shard: number;
  readonly host: string;
  readonly port: number;
}

/** Internal hostnames, so this is deliberately stricter than a general URL validator. */
export const WORKER_HOST_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/;

const WORKER_BLOCK_ENTRY = /\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/g;
const WORKER_ENV_ENTRY = /^WORKER_(\d+)=(.+):(\d+)$/;

/**
 * Locate the generated CMS configuration.
 *
 * WHY several candidates: the panel runs both from a checkout and from an image, and the
 * generated file lives at a different path in each. Returns null when none exist so the
 * caller can fall back to the generated env file rather than treating it as fatal.
 */
export async function findCmsConfigPath(): Promise<string | null> {
  const candidates = [
    path.join(getRepoRoot(), 'config/cms.toml'),
    path.join(process.cwd(), 'config', 'cms.toml'),
    '/usr/local/etc/cms.toml',
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Absence of one candidate is expected; keep scanning the rest.
    }
  }
  return null;
}

/** Extract the contents of the `Worker = [...]` list, bracket-matched so nested lists are honoured. */
export function extractWorkerBlock(content: string): string | null {
  const keyIndex = content.search(/(^|\n)\s*Worker\s*=\s*\[/);
  if (keyIndex === -1) return null;

  const openIndex = content.indexOf('[', keyIndex);
  if (openIndex === -1) return null;

  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    const character = content[index];
    if (character === '[') depth += 1;
    if (character === ']') depth -= 1;
    if (depth === 0) {
      return content.slice(openIndex + 1, index);
    }
  }

  return null;
}

/** Parse the `["host", port]` entries out of an already-extracted Worker block. */
export function parseWorkerBlock(block: string): Array<{ host: string; port: number }> {
  const entries: Array<{ host: string; port: number }> = [];
  for (const match of block.matchAll(WORKER_BLOCK_ENTRY)) {
    entries.push({ host: match[1], port: Number.parseInt(match[2], 10) });
  }
  return entries;
}

/** Read the `WORKER_<n>=host:port` lines that `__config_sync.sh` renders for the compose files. */
function parseEnvEntries(content: string): Array<{ shard: number; host: string; port: number }> {
  const entries: Array<{ shard: number; host: string; port: number }> = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = trimmed.match(WORKER_ENV_ENTRY);
    if (match === null) continue;
    entries.push({
      shard: Number.parseInt(match[1], 10),
      host: match[2],
      port: Number.parseInt(match[3], 10),
    });
  }
  return entries.sort((left, right) => left.shard - right.shard);
}

/**
 * The configured worker endpoints, taken from cms.toml's Worker block when it declares any
 * and from the generated env file otherwise.
 *
 * WHY the env fallback: the Admin Panel UI writes the Worker block, but a deployment that
 * never used that screen only has the rendered env file, and a registry that silently came
 * back empty would look like "no workers configured" rather than "not read".
 */
export async function readConfiguredWorkers(): Promise<WorkerEndpoint[]> {
  const configPath = await findCmsConfigPath();

  if (configPath !== null) {
    const content = await fs.readFile(configPath, 'utf-8');
    const block = extractWorkerBlock(content);
    if (block !== null) {
      const entries = parseWorkerBlock(block);
      if (entries.length > 0) {
        return entries.map((entry, shard) => ({ shard, host: entry.host, port: entry.port }));
      }
    }
  }

  const envContent = await fs.readFile(path.join(getRepoRoot(), '.env'), 'utf-8');
  return parseEnvEntries(envContent);
}
