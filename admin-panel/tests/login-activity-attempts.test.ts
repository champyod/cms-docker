import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lockoutRedisUrl: vi.fn(),
  listAttempts: vi.fn(),
}));

vi.mock('@/lib/redis-lockouts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/redis-lockouts')>();
  return { ...actual, lockoutRedisUrl: mocks.lockoutRedisUrl };
});
vi.mock('@/lib/login-attempts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/login-attempts')>();
  return { ...actual, listAttempts: mocks.listAttempts };
});
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { listCounterAttempts } from '@/lib/security/login-activity';

const ATTEMPT = {
  at: 1760000000000,
  ip: '1.2.3.4',
  surfaceKey: 'ranking',
  path: '/login',
  ua: null,
};

describe('counter attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockoutRedisUrl.mockReturnValue('redis://store');
    mocks.listAttempts.mockResolvedValue([ATTEMPT]);
  });

  it('reads the list under the namespace the key names', async () => {
    await expect(listCounterAttempts('cms:ranking:login:bob|5.6.7.8')).resolves.toEqual({
      ok: true,
      attempts: [ATTEMPT],
    });
    expect(mocks.listAttempts).toHaveBeenCalledWith(
      'redis://store',
      'cms:ranking:login:',
      'bob|5.6.7.8',
    );
  });

  it('refuses a key outside every namespace', async () => {
    await expect(listCounterAttempts('cms:other:key')).resolves.toEqual({
      ok: false,
      error: 'Unknown counter key',
    });
    expect(mocks.listAttempts).not.toHaveBeenCalled();
  });

  it('reports a missing store rather than an empty list', async () => {
    mocks.lockoutRedisUrl.mockReturnValue(null);

    await expect(listCounterAttempts('cms:login:ada|1.2.3.4')).resolves.toEqual({
      ok: false,
      error: 'REDIS_URL is not configured',
    });
  });
});
