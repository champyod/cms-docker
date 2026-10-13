'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { clearLoginLockout, listLoginLockouts, type LoginLockout } from '@/lib/login-lockouts';
import { ensurePermission } from '@/lib/permissions';
import { lockoutRedisUrl } from '@/lib/redis-lockouts';
import { listBlocks, type SecurityBlock } from '@/lib/security/block-ledger';

const LOCKOUTS_PAGE_PATH = '/[locale]/ranking/lockouts';

export type RankingLockoutCounters =
  | { readonly ok: true; readonly lockouts: readonly LoginLockout[] }
  | { readonly ok: false; readonly error: string };

export interface RankingLockoutState {
  readonly counters: RankingLockoutCounters;
  readonly history: readonly SecurityBlock[];
}

async function readCounters(): Promise<RankingLockoutCounters> {
  const url = lockoutRedisUrl();
  if (url === null) {
    return { ok: false, error: 'REDIS_URL is not configured' };
  }
  try {
    return { ok: true, lockouts: await listLoginLockouts(url) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// The ledger does not need Redis, so history is read even while the counter store is down.
async function readHistory(): Promise<readonly SecurityBlock[]> {
  try {
    return await listBlocks({ kind: 'login_lockout' });
  } catch (error) {
    console.error('Ranking lockouts: could not read the ledger', (error as Error).message);
    return [];
  }
}

export async function getRankingLockouts(): Promise<RankingLockoutState> {
  await ensurePermission('lockout:read');
  const [counters, history] = await Promise.all([readCounters(), readHistory()]);
  return { counters, history };
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
  const cleared = await clearLoginLockout(url, key);
  await recordAudit({
    verb: 'ranking:lockout:clear',
    entity: 'ranking',
    entityId: key,
    afterValues: { cleared },
    reason,
    result: 'success',
  });
  revalidatePath(LOCKOUTS_PAGE_PATH);
}
