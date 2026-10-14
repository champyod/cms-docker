import { LOCKOUT_NAMESPACES, lockoutNamespaceFor, type LockoutSurface } from '@/lib/lockout-namespaces';
import { clearLockouts, listLockouts, type RedisLockout } from '@/lib/redis-lockouts';

export interface LoginLockout extends RedisLockout {
  readonly surface: LockoutSurface;
}

export interface LockoutActor {
  readonly username: string | null;
  readonly ip: string;
}

/**
 * The account and address a counter key names. The address family ends its raw
 * key at `ip#` and so carries no account; every other key is `<username>|<ip>`,
 * the shape both web servers write. A key outside every namespace, or one with
 * no separator to split on, is refused rather than guessed at.
 */
export function describeLockoutActor(key: string): LockoutActor | null {
  const entry = lockoutNamespaceFor(key);
  if (entry === null) return null;
  const raw = key.slice(entry.namespace.length);
  if (raw.startsWith('ip#')) return { username: null, ip: raw.slice('ip#'.length) };
  const separator = raw.indexOf('|');
  if (separator < 1) return null;
  return { username: raw.slice(0, separator), ip: raw.slice(separator + 1) };
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
