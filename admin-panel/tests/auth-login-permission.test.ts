import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoginActionState } from '@/app/actions/auth';

const ADMIN_ID = 7;
const USERNAME = 'ada';
const PASSWORD = 'secret';
const STORED_AUTHENTICATION = `plaintext:${PASSWORD}`;

type LoginAction = typeof import('@/app/actions/auth').login;

interface Harness {
  login: LoginAction;
  createSession: ReturnType<typeof vi.fn>;
}

async function loadLoginWith(grantedPermissions: readonly string[]): Promise<Harness> {
  vi.resetModules();
  const createSession = vi.fn(async () => undefined);
  vi.doMock('@/lib/auth', () => ({ createSession, deleteSession: vi.fn(), getSession: vi.fn() }));
  vi.doMock('@/lib/prisma', () => ({
    prisma: {
      admins: {
        findUnique: vi.fn(async () => ({
          id: ADMIN_ID,
          username: USERNAME,
          enabled: true,
          authentication: STORED_AUTHENTICATION,
        })),
        update: vi.fn(async () => undefined),
      },
    },
  }));
  vi.doMock('@/lib/permissions', () => ({
    getFreshPermissions: vi.fn(async () => new Set(grantedPermissions)),
  }));
  vi.doMock('@/lib/permission-engine', () => ({
    hasEffectivePermission: (effective: ReadonlySet<string>, key: string) =>
      effective.has(key) || (effective.has('all:all') && effective.size === 1),
  }));
  vi.doMock('@/lib/captcha', () => ({
    getCaptchaEnv: () => ({ threshold: 3, banThreshold: 5 }),
    getCaptchaPublicConfig: () => ({ enabled: false, provider: 'turnstile', siteKey: '' }),
    verifyCaptcha: vi.fn(async () => true),
  }));
  vi.doMock('@/lib/auth-captcha-helpers', () => ({
    buildCaptchaRequiredState: () => ({ captchaRequired: false }),
    extractCaptchaToken: () => null,
    isCaptchaRequiredForIp: () => false,
    shouldRequireCaptcha: () => false,
  }));
  vi.doMock('@/lib/security/lockouts', () => ({ recordLoginLockout: vi.fn(async () => undefined) }));
  vi.doMock('@/lib/security/exemptions', () => ({ isLoginExempt: vi.fn(async () => false) }));
  vi.doMock('next/headers', () => ({ headers: async () => new Headers() }));
  vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
  vi.doMock('@/lib/redirect', () => ({
    redirect: async (path: string): Promise<never> => {
      throw Object.assign(new Error('NEXT_REDIRECT'), { redirectedTo: path });
    },
  }));
  return { login: (await import('@/app/actions/auth')).login, createSession };
}

function credentials(username: string = USERNAME, password: string = PASSWORD): FormData {
  const formData = new FormData();
  formData.set('username', username);
  formData.set('password', password);
  return formData;
}

async function attemptLogin(login: LoginAction): Promise<LoginActionState> {
  try {
    return await login(null, credentials());
  } catch (error) {
    // `login` ends by delegating to Next's redirect(), which signals its target by throwing.
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') return { success: true };
    throw error;
  }
}

describe('signing in requires admin:login', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', 'auth-login-permission-suite-fixture-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/auth');
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('@/lib/permissions');
    vi.doUnmock('@/lib/permission-engine');
    vi.doUnmock('@/lib/captcha');
    vi.doUnmock('@/lib/auth-captcha-helpers');
    vi.doUnmock('@/lib/security/lockouts');
    vi.doUnmock('@/lib/security/exemptions');
    vi.doUnmock('next/headers');
    vi.doUnmock('next/cache');
    vi.doUnmock('@/lib/redirect');
  });

  it('opens a session for an admin whose group carries admin:login', async () => {
    const { login, createSession } = await loadLoginWith(['admin:login', 'ranking:read']);

    const state = await attemptLogin(login);

    expect(state.error).toBeUndefined();
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a ranking operator, whose group carries no admin:login', async () => {
    const { login, createSession } = await loadLoginWith(['ranking:list', 'ranking:read', 'ranking:override']);

    const state = await attemptLogin(login);

    expect(state.error).toBe('Invalid credentials');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('reports the refusal exactly as a wrong password, so the account is not confirmed', async () => {
    const operator = await loadLoginWith(['ranking:read']);

    const refused = await attemptLogin(operator.login);

    expect(refused.error).toBe('Invalid credentials');
  });
});
