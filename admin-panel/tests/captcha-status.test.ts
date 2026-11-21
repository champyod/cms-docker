import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getCaptchaEnv: vi.fn(),
  isProviderHealthy: vi.fn(),
}));

vi.mock('@/lib/captcha', () => ({ getCaptchaEnv: mocks.getCaptchaEnv }));
vi.mock('@/lib/captcha-health', () => ({ isProviderHealthy: mocks.isProviderHealthy }));

import { readCaptchaStatus } from '@/lib/captcha-status';

const ENV = {
  enabled: true,
  providers: ['turnstile', 'hcaptcha'],
  keys: {},
  threshold: 3,
  banThreshold: 5,
};

describe('captcha status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCaptchaEnv.mockReturnValue(ENV);
    mocks.isProviderHealthy.mockResolvedValue(true);
  });

  it('reports every configured provider with its own health', async () => {
    mocks.isProviderHealthy.mockImplementation(async (provider: string) => provider === 'turnstile');

    await expect(readCaptchaStatus(true)).resolves.toEqual({
      enabled: true,
      threshold: 3,
      banThreshold: 5,
      counterStoreReachable: true,
      providers: [
        { provider: 'turnstile', healthy: true },
        { provider: 'hcaptcha', healthy: false },
      ],
    });
  });

  it('flags an unreachable counter store even while every provider reads healthy', async () => {
    const status = await readCaptchaStatus(false);

    expect(status.counterStoreReachable).toBe(false);
    expect(status.enabled).toBe(true);
    expect(status.providers).toEqual([
      { provider: 'turnstile', healthy: true },
      { provider: 'hcaptcha', healthy: true },
    ]);
  });

  it('carries the environment thresholds through unchanged', async () => {
    mocks.getCaptchaEnv.mockReturnValue({ ...ENV, enabled: false, threshold: 7, banThreshold: 9 });

    const status = await readCaptchaStatus(true);

    expect(status.enabled).toBe(false);
    expect(status.threshold).toBe(7);
    expect(status.banThreshold).toBe(9);
  });
});
