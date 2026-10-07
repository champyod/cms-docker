import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

const mocks = vi.hoisted(() => ({
  getRoutePermissions: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/navigation/page-authorization', () => ({
  getRoutePermissions: mocks.getRoutePermissions,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import type { Dictionary } from '@/lib/dictionary';
import {
  concealedPermissions,
  labelForDescriptor,
  permittedNavItems,
} from '@/lib/navigation/module-nav';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { AuthorizationError } from '@/lib/server/authorization';

const ADMIN_READER: ReadonlySet<string> = new Set([
  'admin:list',
  'admin:read',
  'group:list',
  'group:read',
  'audit:list',
  'audit:read',
]);

function descriptorFor(routeId: RouteId, labelKey?: string): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) throw new Error(`Missing descriptor: ${routeId}`);
  return labelKey === undefined ? descriptor : { ...descriptor, labelKey };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('labelForDescriptor', () => {
  it.each([
    ['en', en],
    ['th', th],
  ])('resolves a non-blank label for every registry descriptor in %s', (_locale, dict) => {
    for (const descriptor of ROUTE_REGISTRY) {
      const label = labelForDescriptor(dict, descriptor);
      expect(typeof label).toBe('string');
      expect(label.trim()).not.toBe('');
    }
  });

  it('reads the descriptor labelKey out of the dictionary', () => {
    expect(labelForDescriptor(en, descriptorFor('administration.admins')))
      .toBe('Admins');
    expect(labelForDescriptor(th, descriptorFor('administration.admins')))
      .toBe(th.navigation.administration.admins.label);
  });

  it('fails the render on a label the dictionary does not carry', () => {
    const descriptor = descriptorFor('administration.admins', 'navigation.nope.label');
    expect(() => labelForDescriptor(en, descriptor)).toThrow(
      'Missing navigation label: navigation.nope.label',
    );
  });

  it('fails the render on a label that is present but blank', () => {
    const blank: Dictionary = structuredClone(en);
    blank.navigation.administration.admins.label = '   ';
    const descriptor = descriptorFor('administration.admins', 'navigation.administration.admins.label');
    expect(() => labelForDescriptor(blank, descriptor)).toThrow(
      'Missing navigation label: navigation.administration.admins.label',
    );
  });
});

describe('permittedNavItems', () => {
  it('builds the administration rail in group order with localized labels', () => {
    expect(permittedNavItems('administration', 'en', en, ADMIN_READER)).toEqual([
      { id: 'administration.admins', label: en.navigation.administration.admins.label, href: '/en/administration/admins' },
      { id: 'administration.groups', label: en.navigation.administration.groups.label, href: '/en/administration/groups' },
      { id: 'administration.audit', label: en.navigation.administration.audit.label, href: '/en/administration/audit' },
    ]);
  });

  it('builds the infrastructure rail from the same helper', () => {
    const items = permittedNavItems(
      'infrastructure',
      'en',
      en,
      new Set(['container:list', 'container:read']),
    );
    expect(items.map((item) => item.id)).toEqual(['infrastructure.containers']);
    expect(items[0]?.href).toBe('/en/infrastructure/containers');
  });

  it('keeps the locale prefix in every href', () => {
    const items = permittedNavItems('administration', 'th', th, ADMIN_READER);
    expect(items.every((item) => item.href.startsWith('/th/'))).toBe(true);
  });

  it('omits a route the reader may not open rather than rendering it disabled', () => {
    const items = permittedNavItems(
      'administration',
      'en',
      en,
      new Set(['admin:list', 'admin:read']),
    );
    expect(items.map((item) => item.id)).toEqual(['administration.admins']);
  });

  it('builds the system rail from the same helper, Docs then About last', () => {
    expect(permittedNavItems('system', 'en', en, new Set(['all:all']))).toEqual([
      { id: 'system.appearance', label: en.navigation.system.appearance.label, href: '/en/system/appearance' },
      { id: 'system.maintenance', label: en.navigation.system.maintenance.label, href: '/en/system/maintenance' },
      { id: 'system.backup-restore', label: en.navigation.system['backup-restore'].label, href: '/en/system/backup-restore' },
      { id: 'system.settings', label: en.navigation.system.settings.label, href: '/en/system/settings' },
      { id: 'system.docs', label: en.navigation.system.docs.label, href: '/en/system/docs' },
      { id: 'system.about', label: en.navigation.system.about.label, href: '/en/system/about' },
    ]);
  });

  it('omits a gated system route the reader may not open while keeping the public routes', () => {
    const items = permittedNavItems('system', 'en', en, new Set(['backup:create']));
    expect(items.map((item) => item.id)).toEqual(['system.maintenance', 'system.backup-restore', 'system.docs', 'system.about']);
  });
});

describe('concealedPermissions', () => {
  it('returns the effective permission set', async () => {
    const effective = new Set(['admin:list']);
    mocks.getRoutePermissions.mockResolvedValue(effective);
    await expect(concealedPermissions()).resolves.toBe(effective);
  });

  it('converts only typed 403 to concealed not-found', async () => {
    mocks.getRoutePermissions.mockRejectedValue(new AuthorizationError(403));
    await expect(concealedPermissions()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('rethrows typed 401 without concealment', async () => {
    const failure = new AuthorizationError(401);
    mocks.getRoutePermissions.mockRejectedValue(failure);
    await expect(concealedPermissions()).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected failure unchanged', async () => {
    const failure = new Error('permission store unavailable');
    mocks.getRoutePermissions.mockRejectedValue(failure);
    await expect(concealedPermissions()).rejects.toBe(failure);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
