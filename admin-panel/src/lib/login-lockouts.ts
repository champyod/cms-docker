import { createClient } from 'redis';

import {
  LOCKOUT_NAMESPACES,
  lockoutNamespaceFor,
  rankingMetadataKeyFor,
  type LockoutSurface,
} from '@/lib/lockout-namespaces';
import { clearLockouts, listLockouts, type RedisLockout } from '@/lib/redis-lockouts';

export interface LoginLockout extends RedisLockout {
  readonly surface: LockoutSurface;
}

export interface LockoutActor {
  readonly username: string | null;
  readonly ip: string;
}

/** The account and address a counter key names; hashed accounts carry their display facts in metadata. */
export function describeLockoutActor(key: string): LockoutActor | null {
  const entry = lockoutNamespaceFor(key);
  if (entry === null) return null;
  const raw = key.slice(entry.namespace.length);
  if (raw.startsWith('ip#')) return { username: null, ip: raw.slice('ip#'.length) };
  const separator = raw.indexOf('|');
  if (separator < 1) return null;
  return { username: raw.slice(0, separator), ip: raw.slice(separator + 1) };
}

function parseIdentity(raw: string | null): LockoutActor | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.username !== 'string' || typeof record.ip !== 'string') return null;
    return { username: record.username, ip: record.ip };
  } catch {
    return null;
  }
}

/** Read ranking display facts with one connection; missing values fall back to the raw key. */
export async function loadRankingIdentities(
  url: string,
  keys: readonly string[],
): Promise<Map<string, LockoutActor>> {
  const pairs = keys
    .map((key) => ({ key, metadata: rankingMetadataKeyFor(key) }))
    .filter((pair): pair is { key: string; metadata: string } => pair.metadata !== null);
  if (pairs.length === 0) return new Map();
  const client = createClient({ url });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const values = await client.mGet(pairs.map((pair) => pair.metadata));
    const identities = new Map<string, LockoutActor>();
    pairs.forEach((pair, index) => {
      const identity = parseIdentity(values[index] ?? null);
      if (identity !== null) identities.set(pair.key, identity);
    });
    return identities;
  } finally {
    await client.quit();
  }
}

/** Every live counter on every surface, tagged with the surface it came from. */
export async function listLoginLockouts(url: string): Promise<LoginLockout[]> {
  const rows = await Promise.all(
    LOCKOUT_NAMESPACES.map(async (entry) => {
      const lockouts = await listLockouts(url, entry.namespace);
      return lockouts.map((lockout) => ({ ...lockout, surface: entry.surface }));
    }),
  );
  return rows.flat().sort((left, right) => right.count - left.count);
}

/**
 * Clears one key, but only under the namespace its own prefix names. A key that
 * belongs to no namespace is refused rather than passed on as a prefix to guess.
 */
export async function clearLoginLockout(url: string, key: string): Promise<number> {
  const entry = lockoutNamespaceFor(key);
  if (entry === null) {
    throw new Error('Refusing to clear a key outside every lockout namespace');
  }
  return clearLockouts(url, entry.namespace, [key]);
}
