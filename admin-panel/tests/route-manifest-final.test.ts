import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import { LEGACY_REDIRECT_RULES, resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { buildRoute } from '@/lib/navigation/routes';
import type {
  NavigationSurface,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

const PAGE_ROOT = 'src/app/[locale]/(authenticated)';
const ALL_SURFACES: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-primary',
  'mobile-more',
  'palette',
  'search',
  'shortcuts',
  'tabs',
  'breadcrumbs',
];
const PRIMARY_SURFACES: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-primary',
  'mobile-more',
];
const ADMIN_READER = ['admin:list', 'admin:read'];
const GROUP_READER = ['group:list', 'group:read'];
const AUDIT_READER = ['audit:list', 'audit:read'];

function pageFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return [...pageFiles(path)];
    return path.endsWith('page.tsx') ? [path] : [];
  });
}

function pageSuffixFor(route: RouteDescriptor): string {
  const suffix = route.path.replace(/^\//, '');
  return suffix === '' ? 'page.tsx' : `${suffix}/page.tsx`;
}

function routeParamsFor(route: RouteDescriptor): Record<string, string> {
  return route.path.includes('[id]') ? { id: '7' } : {};
}

const ENABLED_ROUTES = ROUTE_REGISTRY.filter((route) => route.enabled);

describe('final route manifest and filesystem parity', () => {
  it('has a real page file for every enabled canonical route', () => {
    const files = pageFiles(PAGE_ROOT).map((file) =>
      relative(PAGE_ROOT, file).split(sep).join('/'),
    );
    const missing = ENABLED_ROUTES
      .map(pageSuffixFor)
      .filter((suffix) => !files.includes(suffix));
    expect(missing).toEqual([]);
  });

  it('declares every enabled page route in a navigation group except Search', () => {
    const grouped = new Set(NAVIGATION_GROUPS.flatMap((group) => group.routeIds));
    const ungrouped = ENABLED_ROUTES
      .filter((route) => route.kind === 'page')
      .map((route) => route.id)
      .filter((id) => id !== 'system.search' && !grouped.has(id));
    expect(ungrouped).toEqual([]);
  });

  it('keeps every record landing path under its own list page', () => {
    const offenders: string[] = [];
    for (const route of ENABLED_ROUTES) {
      if (route.kind !== 'record-landing' || !route.parentId) continue;
      const parent = ROUTE_REGISTRY.find((candidate) => candidate.id === route.parentId);
      if (!parent?.path || !route.path.startsWith(`${parent.path}/`)) {
        offenders.push(route.id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('preserves the locale on every enabled route and never hard-codes one', () => {
    for (const route of ENABLED_ROUTES) {
      const built = buildRoute('th', route.id, routeParamsFor(route));
      expect(built, route.id).toMatch(/^\/th(?:\/|$)/);
      expect(built, route.id).not.toMatch(/^\/(?:en|fr|de|th)\b.*\/(?:en|fr|de)\//);
    }
    expect(buildRoute('en', 'home')).toBe('/en');
  });

  it('resolves every declared legacy path through the one redirect resolver', () => {
    const declared = [
      ...ENABLED_ROUTES.flatMap((route) => route.legacyPaths),
      ...LEGACY_REDIRECT_RULES.map((rule) => rule.path),
    ];
    expect(new Set(declared).size).toBe(declared.length);
    for (const legacyPath of declared) {
      const target = resolveLegacyRedirect('en', legacyPath, new Set(['all:all']));
      expect(target, legacyPath).not.toBeNull();
      expect(target, legacyPath).toMatch(/^\/en\//);
    }
  });
});

describe('final surface parity', () => {
  it('derives every surface from the same visibility and permission predicate', () => {
    const readers = [
      new Set<string>(),
      new Set(['contest:list']),
      new Set(['task:list', 'task:read']),
      new Set(['user:list', 'user:read']),
      new Set(['team:list', 'team:read']),
      new Set([...ADMIN_READER, ...GROUP_READER, ...AUDIT_READER]),
      new Set(['all:all']),
    ];
    for (const effective of readers) {
      for (const surface of ALL_SURFACES) {
        const expected = ENABLED_ROUTES
          .filter((route) => route.surfaces.includes(surface))
          .filter((route) => isRoutePermitted(route, effective))
          .map((route) => route.id);
        expect(visibleRoutes(effective, surface).map((route) => route.id), surface).toEqual(expected);
      }
    }
  });

  it('keeps Search off every primary surface and enabled everywhere it is declared', () => {
    const search = ROUTE_REGISTRY.find((route) => route.id === 'system.search');
    expect(search?.kind).toBe('search');
    expect(search?.enabled).toBe(true);
    for (const surface of PRIMARY_SURFACES) {
      expect(search?.surfaces, surface).not.toContain(surface);
    }
  });

  it('keeps Search reachable from the palette, the search page, and shortcuts only', () => {
    const search = ROUTE_REGISTRY.find((route) => route.id === 'system.search');
    expect([...(search?.surfaces ?? [])].sort()).toEqual(['palette', 'search', 'shortcuts']);
  });
});

describe('final redirect parity', () => {
  it('falls back through the Administration group in Admins, Groups, Audit order', () => {
    expect(resolveLegacyRedirect('th', '/permissions', new Set(ADMIN_READER)))
      .toBe('/th/administration/admins');
    expect(resolveLegacyRedirect('th', '/permissions', new Set(GROUP_READER)))
      .toBe('/th/administration/groups');
    expect(resolveLegacyRedirect('th', '/permissions', new Set(AUDIT_READER)))
      .toBe('/th/administration/audit');
  });

  it('conceals a denied target instead of redirecting to it', () => {
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['settings:update']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/audit', new Set(['settings:update']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/unknown-legacy', new Set(['all:all']))).toBeNull();
  });

  it('falls back inside the denied target group rather than out of it', () => {
    expect(resolveLegacyRedirect('en', '/admins', new Set(GROUP_READER)))
      .toBe('/en/administration/groups');
    expect(resolveLegacyRedirect('en', '/audit', new Set(ADMIN_READER)))
      .toBe('/en/administration/admins');
    expect(resolveLegacyRedirect('en', '/docs', new Set(['all:all']))).toBe('/en/system/docs');
  });

  it('does not redirect a list-only reader into a record they cannot read', () => {
    expect(resolveLegacyRedirect('en', '/admins', new Set(['admin:list']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/groups', new Set(['group:list']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/audit', new Set(['audit:list']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/permissions?tab=admins', new Set(['admin:list']))).toBeNull();
    expect(resolveLegacyRedirect('en', '/permissions?tab=groups', new Set(['group:list']))).toBeNull();
  });

  it('never resolves a legacy path to the legacy path it was asked for', () => {
    for (const route of ENABLED_ROUTES) {
      for (const legacyPath of route.legacyPaths) {
        const target = resolveLegacyRedirect('en', legacyPath, new Set(['all:all']));
        expect(target, legacyPath).not.toBe(legacyPath);
        expect(target, legacyPath).not.toBe(`/en${legacyPath}`);
      }
    }
  });
});

describe('final group coverage parity', () => {
  it('declares each group route in exactly one group', () => {
    const seen = new Map<RouteId, string>();
    const duplicates: string[] = [];
    for (const group of NAVIGATION_GROUPS) {
      for (const id of group.routeIds) {
        const owner = seen.get(id);
        if (owner) duplicates.push(`${id} in ${owner} and ${group.id}`);
        seen.set(id, group.id);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('references only declared route ids from every group', () => {
    const declared = new Set(ROUTE_REGISTRY.map((route) => route.id));
    const unknown = NAVIGATION_GROUPS.flatMap((group) =>
      group.routeIds.filter((id) => !declared.has(id)),
    );
    expect(unknown).toEqual([]);
  });
});
