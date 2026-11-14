import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteDescriptor } from '@/lib/navigation/types';

/**
 * The landing page is the one route that cannot be negotiated.
 *
 * WHY this is a gate and not a convention: the route registry is what the sidebar renders from, so it
 * is the promise the product makes about where a user may go. The home page carried its own guard
 * (`all:all` → `notFound()`), which contradicted that promise: every admin without the wildcard
 * permission was shown a **Home** link on arrival and got a 404 from it — the default destination of
 * the whole panel. Two sources of truth, and the visible one lost. A written rule would not have
 * caught it; a test that reads both does.
 */

const PANEL_ROOT = path.resolve(__dirname, '..');
const HOME_PAGE = path.join(PANEL_ROOT, 'src/app/[locale]/(authenticated)/page.tsx');

const HOME = ROUTE_REGISTRY.find((route) => route.id === 'home');

/** A user with no direct grants at all — the smallest set the panel can hand a signed-in admin. */
const NO_GRANTS: ReadonlySet<string> = new Set<string>();

function isDestination(route: RouteDescriptor): boolean {
  return route.enabled && !route.path.includes('[');
}

describe('the landing page is reachable by every admin', () => {
  it('declares home as a destination that needs no grant', () => {
    expect(HOME, 'the registry has no home route').toBeDefined();
    expect(isDestination(HOME!)).toBe(true);
    expect(HOME!.path).toBe('/');
    expect(HOME!.permission).toEqual({});
  });

  it('is permitted for a user who holds nothing', () => {
    expect(isRoutePermitted(HOME!, NO_GRANTS)).toBe(true);
  });

  it('does not demand a grant its descriptor does not declare', () => {
    // The defect this file exists for: the page asked for `all:all` while the registry promised the
    // route to everyone. Any permission the page names must also be declared by its descriptor.
    const source = fs.readFileSync(HOME_PAGE, 'utf8');
    const named = [...source.matchAll(/checkPermission\(\s*'([^']+)'/g)].map((match) => match[1]);
    const declared = new Set<string>([
      ...(HOME!.permission.all ?? []),
      ...(HOME!.permission.any ?? []),
    ]);
    for (const key of named) {
      expect(
        declared.has(key),
        `page.tsx gates on '${key}', which the home descriptor does not declare`,
      ).toBe(true);
    }
  });

  it('never answers a signed-in admin with 404 for the landing page', () => {
    // Concealment (403 → 404) is the right answer for a record that may not exist. It is the wrong
    // answer for the place login sends everyone: a 404 there reads as a broken product.
    const source = fs.readFileSync(HOME_PAGE, 'utf8');
    expect(source).not.toMatch(/notFound\(\)/);
  });
});

describe('the navigation manifest is internally consistent', () => {
  it('names only routes the registry defines', () => {
    const ids = new Set(ROUTE_REGISTRY.map((route) => route.id));
    for (const group of NAVIGATION_GROUPS) {
      for (const id of group.routeIds) {
        expect(ids.has(id), `group '${group.id}' names unknown route '${id}'`).toBe(true);
      }
    }
  });

  it('has at least one destination every admin can open', () => {
    const reachable = ROUTE_REGISTRY.filter(
      (route) => isDestination(route) && isRoutePermitted(route, NO_GRANTS),
    );
    // Without this the panel can hand a signed-in user a session and nowhere to go.
    expect(reachable.length).toBeGreaterThan(0);
  });
});
