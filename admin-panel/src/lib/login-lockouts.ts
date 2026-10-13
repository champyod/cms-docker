import {
  clearLockouts,
  describeLockoutKey as describeKey,
  isLockoutKey,
  listLockouts,
  type RedisLockout,
} from '@/lib/redis-lockouts';

// The contest and classic-admin web servers count failures under this namespace
// (REDIS_KEY_PREFIX in src/cms/server/login_counter_backend.py). They never write a
// security_blocks row, so the panel reads and clears their counters straight from Redis.
const NAMESPACE = 'cms:login:';

export type LoginLockout = RedisLockout;

export function isLoginLockoutKey(key: string): boolean {
  return isLockoutKey(NAMESPACE, key);
}

export function describeLoginLockoutKey(key: string): string {
  return describeKey(NAMESPACE, key);
}

export async function listLoginLockouts(url: string): Promise<LoginLockout[]> {
  return listLockouts(url, NAMESPACE);
}

export async function clearLoginLockouts(url: string, keys: readonly string[]): Promise<number> {
  return clearLockouts(url, NAMESPACE, keys);
}
