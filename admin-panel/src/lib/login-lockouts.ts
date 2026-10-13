import { LOCKOUT_NAMESPACES, lockoutNamespaceFor, type LockoutSurface } from '@/lib/lockout-namespaces';
import { clearLockouts, listLockouts, type RedisLockout } from '@/lib/redis-lockouts';

export interface LoginLockout extends RedisLockout {
  readonly surface: LockoutSurface;
}

/** Every live counter on every surface, tagged with the surface it came from. */
export async function listLoginLockouts(url: string): Promise<LoginLockout[]> {
  const rows = await Promise.all(
    LOCKOUT_NAMESPACES.map(async (entry) => {
      const lockouts = await listLockouts(url, entry.namespace);
      return lockouts.map((lockout) => ({ ...lockout, surface: entry.label }));
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
