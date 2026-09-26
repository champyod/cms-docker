import { beforeEach, describe, expect, it, vi } from 'vitest';

import ContainersRedirectPage from '@/app/[locale]/(authenticated)/containers/page';
import DeploymentsRedirectPage from '@/app/[locale]/(authenticated)/deployments/page';
import RankingRedirectPage from '@/app/[locale]/(authenticated)/ranking/page';
import ResourcesRedirectPage from '@/app/[locale]/(authenticated)/resources/page';

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
    name: 'deployments',
    target: '/en/infrastructure/deployments',
    invoke: (): Promise<never> => DeploymentsRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'containers',
    target: '/en/infrastructure/containers',
    invoke: (): Promise<never> => ContainersRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'resources',
    target: '/en/infrastructure/resources',
    invoke: (): Promise<never> => ResourcesRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
  {
    name: 'ranking',
    target: '/en/infrastructure/ranking',
    invoke: (): Promise<never> => RankingRedirectPage({
      params: Promise.resolve({ locale: 'en' }),
    }),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRoutePermissions.mockResolvedValue(new Set(['route:read']));
  mocks.resolveLegacyRedirect.mockReturnValue('/en/infrastructure/deployments');
});

describe.each(legacyPages)('$name legacy redirect', ({ invoke, target }) => {
  it('redirects with fresh effective permissions', async () => {
    mocks.resolveLegacyRedirect.mockReturnValue(target);
    await expect(invoke()).rejects.toThrow(`NEXT_REDIRECT:${target}`);
    expect(mocks.getRoutePermissions).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith(target);
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

  it('conceals a denied target', async () => {
    mocks.resolveLegacyRedirect.mockReturnValue(null);
    await expect(invoke()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
