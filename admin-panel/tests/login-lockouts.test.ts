import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listLockouts: vi.fn(),
  clearLockouts: vi.fn(),
}));

vi.mock('@/lib/redis-lockouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redis-lockouts')>();
  return { ...actual, listLockouts: mocks.listLockouts, clearLockouts: mocks.clearLockouts };
});

import { clearLoginLockout, listLoginLockouts } from '@/lib/login-lockouts';

const CONTEST_ROW = { key: 'cms:login:ada|1.2.3.4', subject: 'ada from 1.2.3.4', count: 8, retryAfterSeconds: 60 };
const RANKING_ROW = { key: 'cms:ranking:login:bob|5.6.7.8', subject: 'bob from 5.6.7.8', count: 2, retryAfterSeconds: 30 };

describe('login lockouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listLockouts.mockResolvedValue([]);
    mocks.clearLockouts.mockResolvedValue(1);
  });

  it('scans every namespace in the table and tags each row with its surface', async () => {
    mocks.listLockouts.mockImplementation(async (_url: string, namespace: string) =>
      namespace === 'cms:login:' ? [CONTEST_ROW] : [RANKING_ROW],
    );

    const rows = await listLoginLockouts('redis://store');

    expect(mocks.listLockouts).toHaveBeenCalledWith('redis://store', 'cms:login:');
    expect(mocks.listLockouts).toHaveBeenCalledWith('redis://store', 'cms:ranking:login:');
    expect(rows).toEqual([
      { ...CONTEST_ROW, surface: 'contest' },
      { ...RANKING_ROW, surface: 'ranking' },
    ]);
  });

  it('clears a key under the namespace its own prefix names', async () => {
    await expect(clearLoginLockout('redis://store', 'cms:ranking:login:bob|5.6.7.8')).resolves.toBe(1);

    expect(mocks.clearLockouts).toHaveBeenCalledWith('redis://store', 'cms:ranking:login:', [
      'cms:ranking:login:bob|5.6.7.8',
    ]);
  });

  it('refuses to clear a key that matches no namespace', async () => {
    await expect(clearLoginLockout('redis://store', 'cms:contest:login:ada|1.2.3.4')).rejects.toThrow();
    expect(mocks.clearLockouts).not.toHaveBeenCalled();
  });
});
