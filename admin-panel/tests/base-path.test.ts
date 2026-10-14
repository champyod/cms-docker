import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

import { DEFAULT_LOCALE } from '@/lib/locales';
import { buildRoute } from '@/lib/navigation/routes';

const ORIGIN = 'http://localhost:3000';
const BETA_BASE_PATH = '/beta';
const ROOT_BASE_PATH = '';

afterEach(() => {
  vi.doUnmock('@/lib/auth');
  vi.unstubAllEnvs();
});

async function loadBasePath(basePath: string): Promise<typeof import('@/lib/base-path')> {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', basePath);
  vi.resetModules();
  return await import('@/lib/base-path');
}

/** A request as Next hands middleware: the URL still carries the prefix and reports it separately
 * on `nextUrl.basePath`, which is what leaves `nextUrl.pathname` with the prefix stripped. */
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

async function loadSignoutRoute(basePath: string): Promise<typeof import('@/app/[locale]/auth/signout/route')> {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', basePath);
  vi.resetModules();
  vi.doMock('@/lib/auth', () => ({ deleteSession: async (): Promise<void> => undefined }));
  return await import('@/app/[locale]/auth/signout/route');
}

function pathnameOf(location: string): string {
  return new URL(location, ORIGIN).pathname;
}

function locationPathname(response: Response): string {
  const location = response.headers.get('location');
  if (location === null) throw new Error('response carried no Location header');
  return pathnameOf(location);
}

/** Runs the signout route and translates the thrown redirect the way the framework does, so the
 * path under test is the one the browser would be sent to. */
async function signoutLocation(locale: string, basePath: string): Promise<string> {
  const route = await loadSignoutRoute(basePath);
  const { isRedirectError } = await import('next/dist/client/components/redirect-error');
  const { getURLFromRedirectError } = await import('next/dist/client/components/redirect');
  const request = await buildRequest(`/${locale}/auth/signout`, basePath);
  try {
    await route.GET(request, { params: Promise.resolve({ locale }) });
  } catch (error) {
    if (!isRedirectError(error)) throw error;
    return pathnameOf(getURLFromRedirectError(error));
  }
  throw new Error('signout route did not redirect');
}

describe('withBasePath', () => {
  it('returns a root-absolute path untouched when the deployment has no base path', async () => {
    const { withBasePath } = await loadBasePath(ROOT_BASE_PATH);

    expect(withBasePath('/api/users')).toBe('/api/users');
  });

  it('prefixes a root-absolute path when the deployment sets one', async () => {
    const { withBasePath } = await loadBasePath(BETA_BASE_PATH);

    expect(withBasePath('/api/users')).toBe('/beta/api/users');
  });

  it('prefixes a path that carries a query string', async () => {
    const { withBasePath } = await loadBasePath(BETA_BASE_PATH);

    expect(withBasePath('/api/users?page=2&search=ada')).toBe('/beta/api/users?page=2&search=ada');
  });

  it('leaves a URL that already names its own origin alone', async () => {
    const { withBasePath } = await loadBasePath(BETA_BASE_PATH);

    expect(withBasePath('https://example.test/api/users')).toBe('https://example.test/api/users');
    expect(withBasePath('blob:http://localhost:3000/9c1e')).toBe('blob:http://localhost:3000/9c1e');
  });
});

describe('proxy locale redirect', () => {
  it('keeps the root behaviour when no base path is configured', async () => {
    const { proxy } = await loadProxy(ROOT_BASE_PATH);

    const response = await proxy(await buildRequest('/dashboard', ROOT_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationPathname(response)).toBe('/en/dashboard');
  });

  it('emits the prefix the browser sent when a base path is configured', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/beta/dashboard', BETA_BASE_PATH));

    expect(response.status).toBe(307);
    expect(locationPathname(response)).toBe('/beta/en/dashboard');
  });

  it('emits the prefix for the bare base path itself', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/beta', BETA_BASE_PATH));

    expect(locationPathname(response)).toBe('/beta/en');
  });

  it('recognises the locale it redirects to, so the prefix is not applied twice', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/beta/en/dashboard', BETA_BASE_PATH));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('carries the query string across the redirect', async () => {
    const { proxy } = await loadProxy(BETA_BASE_PATH);

    const response = await proxy(await buildRequest('/beta/search?q=ada', BETA_BASE_PATH));

    expect(locationPathname(response)).toBe('/beta/en/search');
    expect(response.headers.get('location')).toContain('?q=ada');
  });
});

describe('signout route Location', () => {
  it('keeps the root behaviour when no base path is configured', async () => {
    expect(await signoutLocation('en', ROOT_BASE_PATH)).toBe('/en/auth/login');
  });

  it('prefixes the login path, because a Route Handler emits Location verbatim', async () => {
    expect(await signoutLocation('en', BETA_BASE_PATH)).toBe('/beta/en/auth/login');
  });

  it('prefixes the fallback locale path too', async () => {
    expect(await signoutLocation('xx', BETA_BASE_PATH)).toBe(`/beta/${DEFAULT_LOCALE}/auth/login`);
  });
});

describe('page redirects', () => {
  /** Why pinned rather than assumed: Next turns a redirect thrown while rendering a page into its
   * Location header and calls this exact helper first (setHTTPAccessFallbackOrRedirectStatus in
   * app-render). The panel must therefore leave a page-level target unprefixed, or the prefix lands
   * twice; this fails if the framework ever stops prefixing, which is when the panel has to start. */
  it('leaves the prefix to the framework, which adds it to a rendered redirect target', async () => {
    const { addPathPrefix } = await import('next/dist/shared/lib/router/utils/add-path-prefix');
    const target = buildRoute(DEFAULT_LOCALE, 'contests.list');

    expect(target.startsWith(BETA_BASE_PATH)).toBe(false);
    expect(addPathPrefix(target, BETA_BASE_PATH)).toBe(`${BETA_BASE_PATH}${target}`);
  });
});
