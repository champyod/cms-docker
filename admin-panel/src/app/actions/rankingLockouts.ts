'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { ensurePermission } from '@/lib/permissions';
import { lockoutRedisUrl } from '@/lib/redis-lockouts';
import { clearRankingLockouts, listRankingLockouts, type RankingLockout } from '@/lib/ranking-lockouts';

export type RankingLockoutState =
  | { ok: true; lockouts: RankingLockout[] }
  | { ok: false; error: string };

/**
 * The counters live in Redis, so a missing URL is reported rather than shown as "no
 * lockouts": an empty list and an unreachable store look identical otherwise.
 */
export async function getRankingLockouts(): Promise<RankingLockoutState> {
  await ensurePermission('lockout:read');
  const url = lockoutRedisUrl();
  if (url === null) {
    return { ok: false, error: 'REDIS_URL is not configured' };
  }
  try {
    return { ok: true, lockouts: await listRankingLockouts(url) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function clearRankingLockout(formData: FormData): Promise<void> {
  await ensurePermission('lockout:unlock');
  const url = lockoutRedisUrl();
  if (url === null) {
    throw new Error('REDIS_URL is not configured');
  }
  const key = String(formData.get('key') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (key === '' || reason === '') {
    throw new Error('a lockout key and a reason are required');
  }
  const cleared = await clearRankingLockouts(url, [key]);
  await recordAudit({
    verb: 'ranking:lockout:clear',
    entity: 'ranking',
    entityId: key,
    afterValues: { cleared },
    reason,
    result: 'success',
  });
  revalidatePath('/[locale]/ranking/lockouts');
}

