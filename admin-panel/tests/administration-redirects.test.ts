import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminsRedirectPage from '@/app/[locale]/(authenticated)/admins/page';
import AuditRedirectPage from '@/app/[locale]/(authenticated)/audit/page';
import GroupsRedirectPage from '@/app/[locale]/(authenticated)/groups/page';
import PermissionsRedirectPage from '@/app/[locale]/(authenticated)/permissions/page';

const mocks = vi.hoisted(() => ({
  getRoutePermissions: vi.fn(),
  resolveLegacyRedirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/navigation/page-authorization', () => ({
  getRoutePermissions: mocks.getRoutePermissions,
}));
vi.mock('@/lib/navigation/redirects', () => ({
  resolveLegacyRedirect: mocks.resolveLegacyRedirect,
}));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

import { AuthorizationError } from '@/lib/server/authorization';

const legacyPages = [
  {
    name: 'admins',
    invoke: (): Promise<never> => AdminsRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'groups',
    invoke: (): Promise<never> => GroupsRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'audit',
    invoke: (): Promise<never> => AuditRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'permissions',
    invoke: (): Promise<never> => PermissionsRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ tab: 'groups' }),
    }),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRoutePermissions.mockResolvedValue(
    new Set([
      'admin:list',
      'admin:read',
      'group:list',
      'group:read',
      'audit:list',
      'audit:read',
    ]),
  );
  mocks.resolveLegacyRedirect.mockReturnValue('/en/administration/admins');
});

describe.each(legacyPages)('$name legacy redirect', ({ invoke }) => {
  it('redirects an authenticated permitted caller', async () => {
    await expect(invoke()).rejects.toThrow('NEXT_REDIRECT:/en/administration/admins');
    expect(mocks.redirect).toHaveBeenCalledWith('/en/administration/admins');
  });

  it('rethrows typed 401 without concealment', async () => {
    const failure = new AuthorizationError(401);
    mocks.getRoutePermissions.mockRejectedValue(failure);
    await expect(invoke()).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('converts only typed 403 to concealed not-found', async () => {
    mocks.getRoutePermissions.mockRejectedValue(new AuthorizationError(403));
    await expect(invoke()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('rethrows an unexpected failure unchanged', async () => {
    const failure = new Error('permission store unavailable');
    mocks.getRoutePermissions.mockRejectedValue(failure);
    await expect(invoke()).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('conceals a resolved null target instead of exposing it', async () => {
    mocks.resolveLegacyRedirect.mockReturnValue(null);
    await expect(invoke()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('permissions legacy redirect query input', () => {
  it('forwards only a known permissions tab as the legacy path', async () => {
    await expect(
      PermissionsRedirectPage({
        params: Promise.resolve({ locale: 'th' }),
        searchParams: Promise.resolve({ tab: 'groups' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/en/administration/admins');
    expect(mocks.resolveLegacyRedirect).toHaveBeenCalledWith(
      'th',
      '/permissions?tab=groups',
      expect.any(Set),
    );
  });

  it('falls back to the plain permissions path for an unknown tab', async () => {
    await expect(
      PermissionsRedirectPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ tab: 'bogus' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/en/administration/admins');
    expect(mocks.resolveLegacyRedirect).toHaveBeenCalledWith(
      'en',
      '/permissions',
      expect.any(Set),
    );
  });
});
