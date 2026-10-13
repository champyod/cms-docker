import {
  clearLockouts,
  describeLockoutKey as describeKey,
  isLockoutKey,
  listLockouts,
  type RedisLockout,
} from '@/lib/redis-lockouts';

// The console counts failures under this namespace; the panel must never touch anything
// outside it, so every key it clears is checked against the prefix first.
const NAMESPACE = 'cms:ranking:login:';

export type RankingLockout = RedisLockout;

export function isRankingLockoutKey(key: string): boolean {
  return isLockoutKey(NAMESPACE, key);
}

export function describeLockoutKey(key: string): string {
  return describeKey(NAMESPACE, key);
}

export async function listRankingLockouts(url: string): Promise<RankingLockout[]> {
  return listLockouts(url, NAMESPACE);
}

export async function clearRankingLockouts(url: string, keys: readonly string[]): Promise<number> {
  return clearLockouts(url, NAMESPACE, keys);
}
