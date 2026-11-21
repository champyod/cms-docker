import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouteDescriptor } from '@/lib/navigation/types';

const mocks = vi.hoisted(() => ({
  routes: [] as RouteDescriptor[],
  getSession: vi.fn(),
  getFreshPermissions: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/navigation/registry', () => ({ ROUTE_REGISTRY: mocks.routes }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/permissions', () => ({
  getFreshPermissions: mocks.getFreshPermissions,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import {
  authorizeRoutePage,
  getRoutePermissions,
} from '@/lib/navigation/page-authorization';
import { AuthorizationError } from '@/lib/server/authorization';

function descriptor(enabled: boolean): RouteDescriptor {
  return {
    id: 'administration.audit',
    path: '/administration/audit',
    kind: 'page',
    permission: { all: ['audit:read', 'audit:list'] },
    labelKey: 'navigation.administration.audit.label',
    legacyPaths: ['/audit'],
    tabIds: [],
    surfaces: ['sidebar'],
    enabled,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routes.length = 0;
  mocks.getSession.mockResolvedValue({ userId: '1' });
  mocks.getFreshPermissions.mockResolvedValue(
    new Set(['audit:read', 'audit:list']),
  );
});

describe('authorizeRoutePage route-state and auth contract', () => {
  it('does not use getPermissions() in the authorization adapter', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'src/lib/navigation/page-authorization.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/import\s+\{\s*getPermissions\s*\}/);
    expect(source).not.toMatch(/\bgetPermissions\s*\(\s*\)/);
  });

  it('returns not-found for a missing descriptor before session loading', async () => {
    await expect(authorizeRoutePage('administration.audit')).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getFreshPermissions).not.toHaveBeenCalled();
  });

  it('returns not-found for a disabled descriptor before session loading', async () => {
    mocks.routes.push(descriptor(false));
    await expect(authorizeRoutePage('administration.audit')).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getFreshPermissions).not.toHaveBeenCalled();
  });

  it('throws typed 401 when no session exists', async () => {
    mocks.routes.push(descriptor(true));
    mocks.getSession.mockResolvedValue(null);
    await expect(authorizeRoutePage('administration.audit')).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 401,
    });
    expect(mocks.getFreshPermissions).not.toHaveBeenCalled();
  });

  it('throws typed 403 when effective permissions cannot resolve', async () => {
    mocks.routes.push(descriptor(true));
    mocks.getFreshPermissions.mockResolvedValue(null);
    await expect(authorizeRoutePage('administration.audit')).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 403,
    });
  });

  it('returns effective permissions for an enabled permitted route', async () => {
    mocks.routes.push(descriptor(true));
    const effective = new Set(['audit:read', 'audit:list']);
    mocks.getFreshPermissions.mockResolvedValue(effective);
    await expect(authorizeRoutePage('administration.audit')).resolves.toBe(effective);
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.getFreshPermissions).toHaveBeenCalledExactlyOnceWith('1');
  });

  it('conceals an enabled route when its permission predicate fails', async () => {
    mocks.routes.push(descriptor(true));
    mocks.getFreshPermissions.mockResolvedValue(new Set(['audit:list']));
    await expect(authorizeRoutePage('administration.audit')).rejects.toThrow(
      'NEXT_HTTP_ERROR_FALLBACK;404',
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('rethrows an unexpected session failure unchanged', async () => {
    mocks.routes.push(descriptor(true));
    const failure = new Error('session store unavailable');
    mocks.getSession.mockRejectedValue(failure);
    await expect(authorizeRoutePage('administration.audit')).rejects.toBe(failure);
  });
});

describe('AuthorizationError contract used by the adapter', () => {
  it('carries the typed status the pages branch on', () => {
    expect(new AuthorizationError(401).status).toBe(401);
    expect(new AuthorizationError(403).status).toBe(403);
  });
});

describe('getRoutePermissions legacy-redirect adapter', () => {
  it('returns the effective set for a permitted caller', async () => {
    const effective = new Set(['admin:list', 'admin:read']);
    mocks.getFreshPermissions.mockResolvedValue(effective);
    await expect(getRoutePermissions()).resolves.toBe(effective);
  });

  it('throws typed 401 without resolving permissions', async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(getRoutePermissions()).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 401,
    });
    expect(mocks.getFreshPermissions).not.toHaveBeenCalled();
  });

  it('throws typed 403 when effective permissions fail closed', async () => {
    mocks.getFreshPermissions.mockResolvedValue(null);
    await expect(getRoutePermissions()).rejects.toMatchObject({
      name: 'AuthorizationError',
      status: 403,
    });
  });

  it('rethrows an unexpected permission-store failure unchanged', async () => {
    const failure = new Error('permission store unavailable');
    mocks.getFreshPermissions.mockRejectedValue(failure);
    await expect(getRoutePermissions()).rejects.toBe(failure);
  });
});
