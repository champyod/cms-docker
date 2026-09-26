import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import {
  NAVIGATION_GROUPS,
  ROUTE_REGISTRY,
  visibleRoutes,
} from '@/lib/navigation/registry';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { buildRoute } from '@/lib/navigation/routes';
import type { NavigationSurface, RouteDescriptor, RouteId } from '@/lib/navigation/types';

const PERMISSION_SETS: readonly (readonly string[])[] = [
  [],
  ['contest:list'],
  ['task:list'],
  ['user:list'],
  ['team:list'],
  ['admin:list'],
  ['group:list'],
  ['audit:list'],
  ['container:list', 'container:read'],
  ['ranking:list', 'ranking:read'],
  ['maintenance:update'],
  ['backup:create'],
];

const APPROVED_MOBILE_ORDER: readonly RouteId[] = [
  'home',
  'contests.list',
  'tasks.list',
  'people.users',
];

const PRIMARY_SURFACES: readonly NavigationSurface[] = ['sidebar', 'mobile-primary', 'mobile-more'];

const OLD_NAVIGATION_PATTERN =
  /nav-registry|nav-chord|NAV_REGISTRY|NAV_CHORD_KEY_BY_PATH|MOBILE_PRIMARY_LABELS|PALETTE_NAV_ITEMS/;

const HARD_CODED_NAVIGATION_PATH_PATTERN =
  /['"`]\/(users|teams|submissions|permissions|admins|groups|audit|deployments|containers|resources|ranking|appearance|maintenance|settings|docs|contests|tasks|search)\b/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function routeById(id: RouteId): RouteDescriptor {
  const route = ROUTE_REGISTRY.find((entry) => entry.id === id);
  if (!route) throw new Error(`Missing frozen route: ${id}`);
  return route;
}

function groupOf(id: RouteId): string {
  const group = NAVIGATION_GROUPS.find((item) => item.routeIds.includes(id));
  if (!group) throw new Error(`Route is in no navigation group: ${id}`);
  return group.id;
}

describe('final navigation cutover', () => {
  it('uses one permission predicate for Sidebar, mobile More, palette, and shortcuts', () => {
    for (const keys of PERMISSION_SETS) {
      const effective = new Set(keys);
      const sidebar = visibleRoutes(effective, 'sidebar').map((route) => route.id);
      const more = visibleRoutes(effective, 'mobile-more').map((route) => route.id);
      const palette = visibleRoutes(effective, 'palette').map((route) => route.id);
      const shortcuts = visibleRoutes(effective, 'shortcuts').map((route) => route.id);
      const sidebarBeyondDirect = sidebar.filter(
        (id) => groupOf(id) !== 'direct',
      );
      expect(more).toEqual(expect.arrayContaining(sidebarBeyondDirect));
      for (const id of palette) {
        expect(isRoutePermitted(routeById(id), effective), id).toBe(true);
      }
      for (const id of shortcuts) {
        expect(isRoutePermitted(routeById(id), effective), id).toBe(true);
      }
    }
  });

  it('keeps the approved groups and excludes Search from primary surfaces', () => {
    expect(NAVIGATION_GROUPS.map((group) => group.id)).toEqual([
      'direct',
      'people',
      'evaluation',
      'administration',
      'infrastructure',
      'system',
    ]);
    for (const surface of PRIMARY_SURFACES) {
      expect(
        visibleRoutes(new Set(['all:all']), surface).some((route) => route.id === 'system.search'),
        surface,
      ).toBe(false);
    }
    expect(
      visibleRoutes(new Set(['all:all']), 'mobile-primary').map((route) => route.id),
    ).toEqual(APPROVED_MOBILE_ORDER);
  });

  it('expresses the approved mobile order through the mobile-primary surface alone', () => {
    for (const id of APPROVED_MOBILE_ORDER) {
      expect(routeById(id).surfaces, id).toContain('mobile-primary');
    }
    const primaryIds = ROUTE_REGISTRY.filter((route) =>
      route.surfaces.includes('mobile-primary'),
    ).map((route) => route.id);
    expect(primaryIds).toEqual(APPROVED_MOBILE_ORDER);
  });

  it('keeps the foundation direct descriptors enabled', () => {
    for (const id of ['home', 'contests.list', 'tasks.list'] as const) {
      expect(routeById(id).enabled, id).toBe(true);
    }
  });

  it('retains search as the palette and deep-link capability', () => {
    expect(routeById('system.search').enabled).toBe(true);
    expect(routeById('system.search').kind).toBe('search');
  });

  it('keeps locale in buildRoute and preserves the approved redirect fallback', () => {
    expect(buildRoute('th', 'people.users')).toBe('/th/people/users');
    expect(buildRoute('en', 'contests.tabs.overview', { id: 42 })).toBe('/en/contests/42/overview');
    expect(resolveLegacyRedirect('en', '/permissions', new Set(['group:list', 'group:read']))).toBe(
      '/en/administration/groups',
    );
    expect(resolveLegacyRedirect('en', '/permissions', new Set(['settings:update']))).toBeNull();
  });

  it('has no old registry or path-list references in consumers', () => {
    const sourceFiles = filesUnder('src').filter((file) => /\.(ts|tsx)$/.test(file));
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      if (OLD_NAVIGATION_PATTERN.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('has no hard-coded navigation path in a shell or contextual consumer', () => {
    const consumers = [
      'src/components/layout/Sidebar.tsx',
      'src/components/layout/SidebarNavItem.tsx',
      'src/components/layout/MobileBottomBar.tsx',
      'src/components/layout/FullScreenNavOverlay.tsx',
      'src/components/layout/Header.tsx',
      'src/components/palette/CommandPalette.tsx',
      'src/components/palette/CommandPaletteItems.tsx',
      'src/components/palette/palette-data.ts',
      'src/components/palette/entity-searchers.ts',
      'src/hooks/useShortcuts.ts',
      'src/components/shared/NotFoundContent.tsx',
      'src/app/[locale]/(authenticated)/search/SearchClient.tsx',
      'src/components/containers/ContainerHeader.tsx',
      'src/components/tasks/TaskList.tsx',
      'src/components/contests/ContestList.tsx',
    ];
    const offenders: string[] = [];
    for (const file of consumers) {
      if (HARD_CODED_NAVIGATION_PATH_PATTERN.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
