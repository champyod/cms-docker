import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
  requirePermission: vi.fn(),
  getUserTeams: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/people-read-models', () => ({ getUserTeams: mocks.getUserTeams }));
vi.mock('@/i18n', () => ({
  getDictionary: vi.fn(async () => ({
    navigation: { people: { 'user-record': { label: 'User' } } },
    users: {},
  })),
}));
vi.mock('@/lib/server/authorization', () => ({
  requirePermission: mocks.requirePermission,
  AuthorizationError: class AuthorizationError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403) {
      super(`Unauthorized: ${status}`);
      this.name = 'AuthorizationError';
      this.status = status;
    }
  },
}));

import UserTeamsPage from '@/app/[locale]/(authenticated)/people/users/[id]/teams/page';
import { readRecordOrNotFound } from '@/lib/queries/record-access';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { AuthorizationError } from '@/lib/server/authorization';
import type { RouteId } from '@/lib/navigation/types';

const PAGE_ROOT = 'src/app/[locale]/(authenticated)';
const PAGE_PARAMS = { params: Promise.resolve({ locale: 'en', id: '9' }) };
const SESSION_EXPIRED = new AuthorizationError(401);
const PERMISSIONS_DENIED = new AuthorizationError(403, 'team:read');
const TAB_KEYS = ['user:read', 'participation:list', 'team:read'];

const THREE_BRANCH_CATCH =
  /if \(error instanceof AuthorizationError && error\.status === 403\) notFound\(\);\s*throw error;/;

function pageFileFor(routeId: RouteId): string {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Missing route descriptor: ${routeId}`);
  const suffix = route.path.replace(/^\//, '');
  return suffix === '' ? `${PAGE_ROOT}/page.tsx` : `${PAGE_ROOT}/${suffix}/page.tsx`;
}

const ENABLED_TABS = ROUTE_REGISTRY.filter(
  (route) => route.enabled && route.kind === 'nested-tab',
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readRecordOrNotFound concealment contract', () => {
  it('conceals a missing row as not-found', async () => {
    await expect(readRecordOrNotFound(async () => null)).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('conceals a typed 403 as not-found', async () => {
    await expect(
      readRecordOrNotFound(async () => {
        throw PERMISSIONS_DENIED;
      }),
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('propagates a typed 401 for the session-expiration path', async () => {
    const failure = SESSION_EXPIRED;
    await expect(
      readRecordOrNotFound(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected failure unchanged to the route boundary', async () => {
    const failure = new Error('read replica unavailable');
    await expect(
      readRecordOrNotFound(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('returns the resolved row for a permitted reader', async () => {
    const row = { teams: [] };
    await expect(readRecordOrNotFound(async () => row)).resolves.toBe(row);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});

describe('nested tab page error branches are uniform', () => {
  it.each(ENABLED_TABS.map((route) => route.id))(
    '%s conceals only a typed 403 and rethrows everything else',
    (routeId) => {
      const source = readFileSync(pageFileFor(routeId), 'utf8');
      expect(source, routeId).toMatch(THREE_BRANCH_CATCH);
      expect(source, routeId).not.toMatch(/status === 401\) notFound\(\)/);
    },
  );
});

describe('a live tab page distinguishes the three error paths', () => {
  it('conceals a typed 403 from the read model as not-found', async () => {
    mocks.requirePermission.mockResolvedValue(new Set(TAB_KEYS));
    mocks.getUserTeams.mockRejectedValue(PERMISSIONS_DENIED);
    await expect(UserTeamsPage(PAGE_PARAMS)).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
  });

  it('propagates a typed 401 from the tab gate for session expiration', async () => {
    const failure = SESSION_EXPIRED;
    mocks.requirePermission.mockRejectedValue(failure);
    mocks.getUserTeams.mockResolvedValue([]);
    await expect(UserTeamsPage(PAGE_PARAMS)).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected gate failure to the segment error boundary', async () => {
    const failure = new Error('permission store unavailable');
    mocks.requirePermission.mockRejectedValue(failure);
    mocks.getUserTeams.mockResolvedValue([]);
    await expect(UserTeamsPage(PAGE_PARAMS)).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('conceals a partial reader before the read model is reached', async () => {
    mocks.requirePermission.mockResolvedValue(new Set(['user:read']));
    mocks.getUserTeams.mockResolvedValue([]);
    await expect(UserTeamsPage(PAGE_PARAMS)).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(mocks.getUserTeams).not.toHaveBeenCalled();
  });
});
