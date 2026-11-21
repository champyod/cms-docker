import { afterAll, describe, expect, it, beforeEach, vi } from 'vitest';
import { buildIpBucketKey, clearBucket, isRateLimited, loginBuckets, pruneExpiredLoginBuckets, recordFailedAttempt } from '@/lib/auth-rate-limit';

const MAX = 5;

// The store falls back to this map when no shared Redis is configured, which is
// the path under test: pin the URL off so an ambient value cannot switch it.
beforeEach(() => {
  vi.stubEnv('REDIS_URL', '');
  loginBuckets.clear();
});

afterAll(() => vi.unstubAllEnvs());

describe('per-IP bucket alongside per-username bucket', () => {
  it('increments both families on one failed attempt', async () => {
    const keys = ['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')];
    await recordFailedAttempt(keys);
    expect(loginBuckets.get('alice|1.2.3.4')?.count).toBe(1);
    expect(loginBuckets.get('ip#1.2.3.4')?.count).toBe(1);
  });

  it('limits the IP even when the attacker rotates usernames', async () => {
    for (let i = 0; i < MAX; i++) {
      await recordFailedAttempt([`user${i}|1.2.3.4`, buildIpBucketKey('1.2.3.4')]);
    }
    const freshUsernameKeys = ['brandnew|1.2.3.4', buildIpBucketKey('1.2.3.4')];
    expect(loginBuckets.get('brandnew|1.2.3.4')).toBeUndefined();
    expect(await isRateLimited(freshUsernameKeys)).toBe(true);
  });

  it('limits the username bucket independently of the IP bucket', async () => {
    for (let i = 0; i < MAX; i++) {
      await recordFailedAttempt(['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')]);
    }
    expect(await isRateLimited(['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')])).toBe(true);
  });

  it('does not limit an unrelated user from an unrelated address', async () => {
    await recordFailedAttempt(['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')]);
    expect(await isRateLimited(['bob|9.9.9.9', buildIpBucketKey('9.9.9.9')])).toBe(false);
  });

  it('clears both families on a successful login', async () => {
    const keys = ['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')];
    for (let i = 0; i < MAX; i++) await recordFailedAttempt(keys);
    expect(await isRateLimited(keys)).toBe(true);
    await clearBucket(keys);
    expect(await isRateLimited(keys)).toBe(false);
    expect(loginBuckets.size).toBe(0);
  });
});

describe('bucket key separation', () => {
  it('never collides with a username bucket, even a username containing the separator', () => {
    expect(buildIpBucketKey('1.2.3.4')).toBe('ip#1.2.3.4');
    expect(buildIpBucketKey('1.2.3.4')).not.toBe('ip|1.2.3.4');
    expect('a|b|1.2.3.4').not.toBe(buildIpBucketKey('1.2.3.4'));
  });

  it('stays invisible to the endsWith pipe-ip CAPTCHA scan', () => {
    const ip = '1.2.3.4';
    expect(buildIpBucketKey(ip).endsWith(`|${ip}`)).toBe(false);
    expect(`alice|${ip}`.endsWith(`|${ip}`)).toBe(true);
  });

  it('keeps the IP bucket count separate from the username bucket counts', async () => {
    await recordFailedAttempt(['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')]);
    await recordFailedAttempt(['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')]);
    await recordFailedAttempt(['bob|1.2.3.4', buildIpBucketKey('1.2.3.4')]);
    expect(loginBuckets.get('alice|1.2.3.4')?.count).toBe(2);
    expect(loginBuckets.get('bob|1.2.3.4')?.count).toBe(1);
    expect(loginBuckets.get('ip#1.2.3.4')?.count).toBe(3);
  });
});

describe('eviction under flood', () => {
  it('never evicts a bucket that is at the limit', async () => {
    const protectedKeys = ['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')];
    for (let i = 0; i < MAX; i++) await recordFailedAttempt(protectedKeys);
    for (let i = 0; i < 3000; i++) {
      await recordFailedAttempt([`flood${i}|8.8.8.8`, buildIpBucketKey('8.8.8.8')]);
    }
    expect(loginBuckets.get('alice|1.2.3.4')?.count).toBe(MAX);
    expect(loginBuckets.get('ip#1.2.3.4')?.count).toBe(MAX);
    expect(await isRateLimited(protectedKeys)).toBe(true);
  });

  it('keeps the map bounded under flood', async () => {
    for (let i = 0; i < 5000; i++) {
      await recordFailedAttempt([`flood${i}|8.8.8.8`, buildIpBucketKey('8.8.8.8')]);
    }
    expect(loginBuckets.size).toBeLessThanOrEqual(1000);
  });

  it('still evicts something when every bucket is at the limit', async () => {
    // Reaching the oldest-only fallback needs a full map whose every entry is
    // already at the limit, because the caller's own freshly created bucket is
    // itself under the limit and is always the preferred victim.
    loginBuckets.clear();
    for (let i = 0; i < 1000; i++) {
      loginBuckets.set(`flood${i}|7.7.7.7`, { count: MAX, resetAt: Date.now() + 60_000 });
    }
    loginBuckets.set('sentinel|7.7.7.7', { count: MAX, resetAt: Date.now() - 60_000 });
    // Re-entering the sentinel raises it past the limit and refreshes its
    // resetAt, so it is no longer the oldest and the fallback must drop a flood
    // bucket instead of the at-limit victim.
    await recordFailedAttempt(['sentinel|7.7.7.7']);
    expect(loginBuckets.size).toBe(1000);
    expect(loginBuckets.has('sentinel|7.7.7.7')).toBe(true);
    expect(loginBuckets.get('sentinel|7.7.7.7')?.count).toBe(MAX + 1);
  });
});

describe('bucket key selection by client address', () => {
  // Why through resolveBucketKeys and not the predicate: it is the only seam the
  // login action actually consumes, so these cases hold even if the loopback
  // check is later inlined, and the assertions read in the terms the rate
  // limiter sees. The module is reloaded per case because the action reads its
  // headers at call time, which needs a freshly stubbed next/headers.
  async function resolveKeys(forwardedFor?: string): Promise<readonly string[]> {
    vi.resetModules();
    vi.stubEnv('AUTH_SECRET', 'auth-rate-limit-suite-fixture-secret');
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/security/exemptions', () => ({ isLoginExempt: vi.fn(async () => false) }));
    vi.doMock('@/lib/prisma', () => ({
      prisma: { admins: { findUnique: vi.fn(async () => null), update: vi.fn(async () => undefined) } },
    }));
    vi.doMock('next/headers', () => ({
      headers: async () => new Headers(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }),
    }));
    const { login } = await import('@/app/actions/auth');
    const formData = new FormData();
    formData.set('username', 'alice');
    formData.set('password', 'wrong');
    await login(null, formData);
    // Why re-import: the reload above hands the action its own rate-limiter
    // instance, so the one this file imported at load time is a different map.
    const { loginBuckets: reloaded } = await import('@/lib/auth-rate-limit');
    return [...reloaded.keys()];
  }

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.doUnmock('next/headers');
    vi.doUnmock('server-only');
    vi.doUnmock('@/lib/security/exemptions');
    vi.doUnmock('@/lib/prisma');
    vi.resetModules();
  });

  it.each(['127.0.0.1', '127.0.0.53', '::1', '::ffff:127.0.0.1'])(
    'counts the loopback address %j per username only',
    async (ip) => {
      expect(await resolveKeys(ip)).toEqual([`alice|${ip}`]);
    },
  );

  it('counts the local fallback per username only', async () => {
    expect(await resolveKeys()).toEqual(['alice|local']);
  });

  it('counts a remote address in both families', async () => {
    expect(await resolveKeys('203.0.113.7')).toEqual([`alice|203.0.113.7`, buildIpBucketKey('203.0.113.7')]);
  });
});

describe('expiry', () => {
  it('prunes expired buckets and stops reporting a limit', async () => {
    const keys = ['alice|1.2.3.4', buildIpBucketKey('1.2.3.4')];
    for (let i = 0; i < MAX; i++) await recordFailedAttempt(keys);
    loginBuckets.set('alice|1.2.3.4', { count: MAX, resetAt: Date.now() - 1 });
    loginBuckets.set('ip#1.2.3.4', { count: MAX, resetAt: Date.now() - 1 });
    await pruneExpiredLoginBuckets();
    expect(loginBuckets.size).toBe(0);
    expect(await isRateLimited(keys)).toBe(false);
  });
});
