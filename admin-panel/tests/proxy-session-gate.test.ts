import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const ORIGIN = 'http://localhost:3000';
const BETA_BASE_PATH = '/beta';
const ROOT_BASE_PATH = '';
const SECRET = 'proxy-session-gate-suite-secret';

beforeAll(() => {
  // Pinned so the auth module takes the configured-secret branch instead of minting a random one,
  // which would make the signature in one module disagree with the verifier in another.
  vi.stubEnv('AUTH_SECRET', SECRET);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.doUnmock('@/lib/auth');
  vi.doUnmock('@/lib/session-token');
});

/** A request as Next hands the proxy: the base path is reported separately from the pathname. */
async function buildRequest(
  pathname: string,
  basePath: string,
  cookie?: string,
): Promise<NextRequest> {
  const { NextRequest: RequestCtor } = await import('next/server');
  const url = new URL(pathname, ORIGIN);
  const init = {
    ...(basePath === ROOT_BASE_PATH ? {} : { nextConfig: { basePath } }),
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  };
  return new RequestCtor(url, init);
}

async function loadProxy(basePath: string): Promise<typeof import('@/proxy')> {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', basePath);
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.resetModules();
  vi.doMock('@/lib/auth', () => ({ slideSessionCookie: async (): Promise<void> => undefined }));
  return await import('@/proxy');
}

/** Mints a real token with the same module the proxy verifies with. */
async function mintToken(claims: { userId: string; username: string }): Promise<string> {
  vi.stubEnv('AUTH_SECRET', SECRET);
  vi.resetModules();
  const { encrypt, SESSION_COOKIE_NAME } = await import('@/lib/session-token');
  const token = await encrypt({ ...claims, iat: Math.floor(Date.now() / 1000) });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  if (location === null) throw new Error('response carried no Location header');
  const url = new URL(location, ORIGIN);
  return url.pathname + url.search;
}

describe('proxy session gate', () => {
  it('sends a session-less request for a protected page to the login, not into a page query', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/en/contests', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/auth/login');
  });

  it('keeps the locale the caller used', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/th/contests', ROOT_BASE_PATH));

    expect(locationOf(response)).toBe('/th/auth/login');
  });

  it('treats an unreadable cookie as no session', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(
      await buildRequest('/en/contests', ROOT_BASE_PATH, 'session=not-a-token'),
    );

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/auth/login');
  });

  it('lets a request with a valid session through untouched', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);
    const cookie = await mintToken({ userId: '2', username: 'CCYod' });

    const response = await proxy(await buildRequest('/en/contests', ROOT_BASE_PATH, cookie));

    expect(response.status).not.toBe(307);
  });

  it('never gates the auth routes themselves', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/en/auth/login', ROOT_BASE_PATH));

    expect(response.status).not.toBe(307);
  });

  it('still resolves the locale before gating, so a bare path is not sent to login', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/contests', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/contests');
  });

  it('carries the base path on the redirect it emits', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/en/contests', BETA_BASE_PATH));

    expect(locationOf(response)).toBe('/beta/en/auth/login');
  });
});
