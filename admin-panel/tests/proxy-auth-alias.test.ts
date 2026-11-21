import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const ORIGIN = 'http://localhost:3000';
const BETA_BASE_PATH = '/beta';
const ROOT_BASE_PATH = '';

afterEach(() => {
  vi.doUnmock('@/lib/auth');
  vi.unstubAllEnvs();
});

/** As Next hands middleware: the URL still carries the prefix and reports it separately on
 * `nextUrl.basePath`, which is what leaves `nextUrl.pathname` with the prefix stripped. */
async function buildRequest(pathname: string, basePath: string): Promise<NextRequest> {
  const { NextRequest: RequestCtor } = await import('next/server');
  const url = new URL(pathname, ORIGIN);
  return basePath === ROOT_BASE_PATH
    ? new RequestCtor(url)
    : new RequestCtor(url, { nextConfig: { basePath } });
}

async function loadProxy(basePath: string): Promise<typeof import('@/proxy')> {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', basePath);
  vi.resetModules();
  vi.doMock('@/lib/auth', () => ({ slideSessionCookie: async (): Promise<void> => undefined }));
  return await import('@/proxy');
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  if (location === null) throw new Error('response carried no Location header');
  return new URL(location, ORIGIN).pathname + new URL(location, ORIGIN).search;
}

describe('proxy auth alias', () => {
  it('sends the bare /login to the login page instead of a 404', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/login', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/auth/login');
  });

  it('repairs /en/login, where the broken redirect already sends people', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/en/login', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/auth/login');
  });

  it('keeps the query string a caller may have set on the way in', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/login?next=%2Fen%2Fcontests', ROOT_BASE_PATH));

    expect(locationOf(response)).toBe('/en/auth/login?next=%2Fen%2Fcontests');
  });

  it('prefixes the base path the way every other redirect does', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/login', BETA_BASE_PATH));

    expect(locationOf(response)).toBe('/beta/en/auth/login');
  });

  it('leaves the real login route alone', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/en/auth/login', ROOT_BASE_PATH));

    expect(response.status).not.toBe(307);
  });

  it('leaves an unrelated locale-less path on the normal locale redirect', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/dashboard', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('/en/dashboard');
  });
});
