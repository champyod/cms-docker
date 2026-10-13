import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  lockoutRedisUrl: vi.fn(),
  listLoginLockouts: vi.fn(),
  clearLoginLockout: vi.fn(),
  listBlocks: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/redis-lockouts', () => ({ lockoutRedisUrl: mocks.lockoutRedisUrl }));
vi.mock('@/lib/login-lockouts', () => ({
  listLoginLockouts: mocks.listLoginLockouts,
  clearLoginLockout: mocks.clearLoginLockout,
}));
vi.mock('@/lib/security/block-ledger', () => ({ listBlocks: mocks.listBlocks }));

import { clearRankingLockout, getRankingLockouts } from '@/app/actions/rankingLockouts';

const COUNTER = { key: 'cms:login:ada|1.2.3.4', subject: 'ada from 1.2.3.4', count: 8, retryAfterSeconds: 60, surface: 'contest' };
const HISTORY_ROW = {
  id: '1',
  kind: 'login_lockout',
  source: 'app',
  ip: '1.2.3.4',
  subject: 'ada',
  detail: null,
  startedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  active: true,
};

describe('ranking lockout actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePermission.mockResolvedValue(undefined);
    mocks.lockoutRedisUrl.mockReturnValue('redis://store');
    mocks.listLoginLockouts.mockResolvedValue([COUNTER]);
    mocks.listBlocks.mockResolvedValue([HISTORY_ROW]);
    mocks.clearLoginLockout.mockResolvedValue(1);
  });

  it('reads the live counters and the ledger history under the read gate', async () => {
    const state = await getRankingLockouts();

    expect(mocks.ensurePermission).toHaveBeenCalledWith('lockout:read');
    expect(mocks.listLoginLockouts).toHaveBeenCalledWith('redis://store');
    expect(mocks.listBlocks).toHaveBeenCalledWith({ kind: 'login_lockout' });
    expect(state.counters).toEqual({ ok: true, lockouts: [COUNTER] });
    expect(state.history).toEqual([HISTORY_ROW]);
  });

  it('keeps the ledger history when the counter store is not configured', async () => {
    mocks.lockoutRedisUrl.mockReturnValue(null);

    const state = await getRankingLockouts();

    expect(state.counters).toEqual({ ok: false, error: 'REDIS_URL is not configured' });
    expect(state.history).toEqual([HISTORY_ROW]);
  });

  it('clears through the resolved namespace and audits the verb', async () => {
    const form = new FormData();
    form.set('key', 'cms:ranking:login:bob|5.6.7.8');
    form.set('reason', 'operator');

    await clearRankingLockout(form);

    expect(mocks.ensurePermission).toHaveBeenCalledWith('lockout:unlock');
    expect(mocks.clearLoginLockout).toHaveBeenCalledWith('redis://store', 'cms:ranking:login:bob|5.6.7.8');
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'ranking:lockout:clear', result: 'success' }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/ranking/lockouts');
  });
});
