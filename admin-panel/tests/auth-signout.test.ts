import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/lib/locales';
import { ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { NavigationSurface } from '@/lib/navigation/types';

type CookieDeleteOptions = { readonly name?: string; readonly path?: string };
type CookieStore = { readonly delete: (options: CookieDeleteOptions) => void };
type SignoutRoute = typeof import('@/app/[locale]/auth/signout/route');

const ORIGIN = 'http://localhost:3000';
const PALETTE_SOURCE = readFileSync(
  join(__dirname, '..', 'src', 'components', 'palette', 'CommandPalette.tsx'),
  'utf8',
);
const NAVIGATION_SURFACES: readonly NavigationSurface[] = [
  'sidebar', 'mobile-primary', 'mobile-more', 'palette',
  'search', 'shortcuts', 'tabs', 'breadcrumbs',
];

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

function mockPrisma(): void {
  vi.doMock('@/lib/prisma', () => ({
    prisma: {
      admins: { findUnique: vi.fn(async () => ({ username: 'ada', enabled: false })) },
    },
  }));
}

async function loadSignoutRoute(store: CookieStore): Promise<SignoutRoute> {
  vi.resetModules();
  vi.doUnmock('@/lib/auth');
  mockPrisma();
  vi.doMock('next/headers', () => ({ cookies: async () => store }));
  return await import('@/app/[locale]/auth/signout/route');
}

async function loadSignoutRouteOverSpyingAuth(): Promise<{ route: SignoutRoute; deleteSession: () => Promise<void> }> {
  vi.resetModules();
  const deleteSession = vi.fn(async () => undefined);
  vi.doMock('@/lib/auth', () => ({ deleteSession }));
  vi.doMock('next/headers', () => ({
    cookies: async () => {
      throw new Error('the signout route must clear the cookie through deleteSession');
    },
  }));
  return { route: await import('@/app/[locale]/auth/signout/route'), deleteSession };
}

async function callSignout(route: SignoutRoute, locale: string) {
  const { NextRequest } = await import('next/server');
  const { isRedirectError } = await import('next/dist/client/components/redirect-error');
  const { getURLFromRedirectError, getRedirectStatusCodeFromError } = await import(
    'next/dist/client/components/redirect'
  );
  const request = new NextRequest(new URL(`/${locale}/auth/signout`, ORIGIN));
  try {
    return await route.GET(request, { params: Promise.resolve({ locale }) });
  } catch (error) {
    // The route delegates to Next's `redirect()`, which signals the target by throwing rather
    // than by returning a Response. The framework catches that throw and turns it into a
    // Location header, so the harness reproduces that translation to stay framework-faithful.
    if (!isRedirectError(error)) throw error;
    return new Response(null, {
      status: getRedirectStatusCodeFromError(error),
      headers: { location: getURLFromRedirectError(error) },
    });
  }
}

function redirectPathname(headers: Headers): string {
  const location = headers.get('location');
  if (location === null) throw new Error('signout response carried no Location header');
  // The Location is host-relative, so resolve it against the origin to inspect its pathname.
  return new URL(location, ORIGIN).pathname;
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

  it('redirects rather than renders, with a relative Location that leaks no host', async () => {
    const { store } = createCookieRecorder();
    const route = await loadSignoutRoute(store);

    const response = await callSignout(route, 'th');

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    if (location === null) throw new Error('signout response carried no Location header');
    // A host-relative Location is what keeps the server's bind hostname (which Next derives
    // independently of the Host header) out of the browser URL bar.
    expect(new URL(location, ORIGIN).origin).toBe(ORIGIN);
    expect(location.startsWith('/')).toBe(true);
    expect(location).not.toMatch(/^https?:\/\//);
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

  it('routes the clear through deleteSession instead of its own cookie literal', async () => {
    const { route, deleteSession } = await loadSignoutRouteOverSpyingAuth();

    const response = await callSignout(route, 'th');

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(redirectPathname(response.headers)).toBe('/th/auth/login');
  });
});

describe('palette sign-out handoff', () => {
  it('no longer imports the logout Server Action', () => {
    expect(PALETTE_SOURCE).not.toContain('@/app/actions/auth');
    expect(PALETTE_SOURCE).not.toMatch(/\blogout\b/);
  });

  it('resolves the destination from the frozen registry instead of a palette literal', () => {
    expect(PALETTE_SOURCE).toContain("buildRoute(locale, 'auth.signout')");
    // Why these three absences: a literal path, a hand-rolled locale prefixer, and a
    // module-level constant are each a second source the registry cannot check.
    expect(PALETTE_SOURCE).not.toContain('SIGNOUT_PATH');
    expect(PALETTE_SOURCE).not.toContain('buildLocaleHref');
    expect(PALETTE_SOURCE).not.toContain('/auth/signout');
  });

  it('builds the locale-preserving URL the palette navigates to', () => {
    expect(buildRoute('en', 'auth.signout')).toBe('/en/auth/signout');
    expect(buildRoute('th', 'auth.signout')).toBe('/th/auth/signout');
  });

  it('declares auth.signout once, requirement-free, on no navigation surface', () => {
    const declared = ROUTE_REGISTRY.filter((route) => route.id === 'auth.signout');
    expect(declared).toHaveLength(1);
    expect(declared[0]?.path).toBe('/auth/signout');
    expect(declared[0]?.enabled).toBe(false);
    expect(declared[0]?.surfaces).toEqual([]);
    expect(declared[0]?.permission).toEqual({});
    // Why every surface and not one: "not navigable" has to hold across the whole
    // registry, or the descriptor re-enters a rail on the surface left unchecked.
    for (const surface of NAVIGATION_SURFACES) {
      const visible = visibleRoutes(new Set(['all:all']), surface).map((route) => route.id);
      expect(visible, surface).not.toContain('auth.signout');
    }
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
    mockPrisma();
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
