import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';

type CookieDeleteOptions = { readonly name?: string; readonly path?: string };
type CookieStore = { readonly delete: (options: CookieDeleteOptions) => void };
type SignoutRoute = typeof import('@/app/[locale]/auth/signout/route');

const ORIGIN = 'http://localhost:3000';

beforeAll(() => {
  // Pinned so the auth module takes the configured-secret branch and the suite emits no warning
  vi.stubEnv('AUTH_SECRET', 'auth-signout-suite-fixture-secret');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function createCookieRecorder(): { deletes: CookieDeleteOptions[]; store: CookieStore } {
  const deletes: CookieDeleteOptions[] = [];
  const store: CookieStore = {
    delete: (options) => {
      deletes.push(options);
    },
  };
  return { deletes, store };
}

async function loadSignoutRoute(store: CookieStore): Promise<SignoutRoute> {
  vi.resetModules();
  vi.doMock('next/headers', () => ({ cookies: async () => store }));
  return await import('@/app/[locale]/auth/signout/route');
}

async function callSignout(route: SignoutRoute, locale: string) {
  const { NextRequest } = await import('next/server');
  const request = new NextRequest(new URL(`/${locale}/auth/signout`, ORIGIN));
  return await route.GET(request, { params: Promise.resolve({ locale }) });
}

function redirectPathname(headers: Headers): string {
  const location = headers.get('location');
  if (location === null) throw new Error('signout response carried no Location header');
  return new URL(location).pathname;
}

describe('signout locale resolution', () => {
  it.each([...SUPPORTED_LOCALES])('keeps the supported locale %s', async (locale: Locale) => {
    const { deletes, store } = createCookieRecorder();
    const route = await loadSignoutRoute(store);

    const response = await callSignout(route, locale);

    expect(redirectPathname(response.headers)).toBe(`/${locale}/auth/login`);
    expect(deletes).toHaveLength(1);
  });

  it.each(['fr', 'EN', 'e', 'en-GB', ''])(
    'falls back to DEFAULT_LOCALE for the unresolved segment %j',
    async (candidate: string) => {
      const { deletes, store } = createCookieRecorder();
      const route = await loadSignoutRoute(store);

      const response = await callSignout(route, candidate);

      expect(redirectPathname(response.headers)).toBe(`/${DEFAULT_LOCALE}/auth/login`);
      expect(deletes).toHaveLength(1);
    },
  );

  it('redirects rather than renders, and stays on the request origin', async () => {
    const { store } = createCookieRecorder();
    const route = await loadSignoutRoute(store);

    const response = await callSignout(route, 'th');

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    if (location === null) throw new Error('signout response carried no Location header');
    expect(new URL(location).origin).toBe(ORIGIN);
  });

  it('pins the default locale as a member of the supported set', () => {
    expect(SUPPORTED_LOCALES).toContain<Locale>(DEFAULT_LOCALE);
  });
});

describe('signout cookie clear', () => {
  it('deletes the session cookie with the path it was written with', async () => {
    const { deletes, store } = createCookieRecorder();
    const route = await loadSignoutRoute(store);

    await callSignout(route, 'en');

    expect(deletes).toEqual([{ name: 'session', path: '/' }]);
  });

  it('clears the cookie for an unresolved locale too', async () => {
    const { deletes, store } = createCookieRecorder();
    const route = await loadSignoutRoute(store);

    await callSignout(route, 'xx');

    expect(deletes).toEqual([{ name: 'session', path: '/' }]);
  });
});

describe('proxy session sliding', () => {
  async function loadProxy(slide: () => Promise<void>) {
    vi.resetModules();
    vi.doMock('@/lib/auth', () => ({ slideSessionCookie: slide }));
    return await import('@/proxy');
  }

  it.each(['/en/auth/signout', '/th/auth/login', '/en/auth/'])(
    'leaves the session cookie to the /auth/ route on %s',
    async (pathname: string) => {
      const slide = vi.fn(async () => undefined);
      const { proxy } = await loadProxy(slide);
      const { NextRequest } = await import('next/server');

      const response = await proxy(new NextRequest(new URL(pathname, ORIGIN)));

      expect(slide).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    },
  );

  it('slides the session cookie outside /auth/', async () => {
    const slide = vi.fn(async () => undefined);
    const { proxy } = await loadProxy(slide);
    const { NextRequest } = await import('next/server');

    const response = await proxy(new NextRequest(new URL('/en/dashboard', ORIGIN)));

    expect(slide).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

describe('slideSessionCookie path-aware clear', () => {
  async function loadAuth() {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        admins: { findUnique: vi.fn(async () => ({ username: 'ada', enabled: false })) },
      },
    }));
    return await import('@/lib/auth');
  }

  it('expires the cookie with path / when the presented token no longer verifies', async () => {
    const { slideSessionCookie } = await loadAuth();
    const { NextRequest, NextResponse } = await import('next/server');
    // The cookie must arrive in the header: a request's own cookie jar rejects writes
    const request = new NextRequest(new URL('/en/dashboard', ORIGIN), {
      headers: { cookie: 'session=not-a-verifiable-jwt' },
    });
    const response = NextResponse.next();

    await slideSessionCookie(request, response);

    const cleared = response.cookies.get('session');
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe('');
    expect(cleared?.path).toBe('/');
    expect(cleared?.expires).toEqual(new Date(0));
  });
});
