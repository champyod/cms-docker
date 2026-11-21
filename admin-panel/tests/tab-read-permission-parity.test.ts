import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';

const PAGE_ROOT = 'src/app/[locale]/(authenticated)';

// Why these four: the page gate loops the descriptor back through
// requirePermission, so comparing a page to its own descriptor is circular. The
// route-owned read model is the independent owner of the tab's reader boundary,
// so the parity proof has to read that module rather than the route.
const READ_MODEL_MODULES = [
  'src/lib/queries/contest-detail.ts',
  'src/lib/queries/task-detail.ts',
  'src/lib/people-read-models.ts',
  'src/lib/evaluation-read-models.ts',
] as const;

const PAGE_OWNED_GATE =
  'for (const key of route.permission.all ?? []) effective = await requirePermission(key);';

const NON_READ_ACTION_VERBS = [
  'create',
  'update',
  'delete',
  'assign',
  'rejudge',
  'control',
  'restart',
  'deploy',
  'download',
  'export',
  'enable',
  'snapshot',
  'reveal',
] as const;

const CALL_PATTERN = /\bget[A-Z]\w*\b/g;
const REQUIRE_PATTERN = /requirePermission\('([^']+)'\)/g;

function pageFileFor(route: RouteDescriptor): string {
  const suffix = route.path.replace(/^\//, '');
  return suffix === '' ? `${PAGE_ROOT}/page.tsx` : `${PAGE_ROOT}/${suffix}/page.tsx`;
}

function functionBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`export (?:async )?function ${name}\\b`));
  if (start === -1) return null;
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\nexport (?:async )?(?:function|const) /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function requiredKeys(body: string): readonly string[] {
  return [...new Set([...body.matchAll(REQUIRE_PATTERN)].map((match) => match[1]))].sort();
}

function readModelKeys(page: string, depth = 0): readonly string[] {
  if (depth > 1) return [];
  const called = new Set([...page.matchAll(CALL_PATTERN)].map((match) => match[0]));
  const keys = new Set<string>();
  for (const readModel of READ_MODEL_MODULES) {
    const source = readFileSync(readModel, 'utf8');
    for (const name of called) {
      const body = functionBody(source, name);
      if (!body) continue;
      for (const key of requiredKeys(body)) keys.add(key);
      for (const key of readModelKeys(body, depth + 1)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function ownsReadModel(page: string): boolean {
  return page.includes('@/lib/queries/contest-detail')
    || page.includes('@/lib/queries/task-detail')
    || page.includes('@/lib/people-read-models')
    || page.includes('@/lib/evaluation-read-models');
}

function descriptorFor(routeId: RouteId): RouteDescriptor {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Missing route descriptor: ${routeId}`);
  return route;
}

const ENABLED_TABS = ROUTE_REGISTRY.filter(
  (route) => route.enabled && route.kind === 'nested-tab',
);

const READ_MODEL_TABS = ENABLED_TABS.filter((route) =>
  ownsReadModel(readFileSync(pageFileFor(route), 'utf8')),
);

describe('nested tab descriptor and read-model permission parity', () => {
  it.each(ENABLED_TABS.map((route) => route.id))(
    '%s gates every declared key from its own descriptor',
    (routeId) => {
      const page = readFileSync(pageFileFor(descriptorFor(routeId)), 'utf8');
      expect(page, routeId).toContain(PAGE_OWNED_GATE);
      expect(descriptorFor(routeId).permission.any, routeId).toBeUndefined();
    },
  );

  it.each(READ_MODEL_TABS.map((route) => route.id))(
    '%s requires exactly the keys its read model requires',
    (routeId) => {
      const route = descriptorFor(routeId);
      expect(readModelKeys(readFileSync(pageFileFor(route), 'utf8')), routeId).toEqual(
        [...(route.permission.all ?? [])].sort(),
      );
    },
  );

  it.each(ENABLED_TABS.map((route) => route.id))(
    '%s exposes the tab for the complete set and hides it for every partial set',
    (routeId) => {
      const route = descriptorFor(routeId);
      const required = [...(route.permission.all ?? [])].sort();
      expect(visibleRoutes(new Set(required), 'tabs').map((item) => item.id)).toContain(routeId);
      expect(isRoutePermitted(route, new Set(required))).toBe(true);
      for (const missing of required) {
        const partial = required.filter((key) => key !== missing);
        expect(isRoutePermitted(route, new Set(partial)), `${routeId} without ${missing}`).toBe(false);
        expect(visibleRoutes(new Set(partial), 'tabs').map((item) => item.id)).not.toContain(routeId);
      }
    },
  );

  it('keeps action, update, download, and control keys out of every tab descriptor', () => {
    const offenders: string[] = [];
    for (const route of ENABLED_TABS) {
      for (const key of route.permission.all ?? []) {
        const verb = key.split(':')[1] ?? '';
        if ((NON_READ_ACTION_VERBS as readonly string[]).includes(verb)) {
          offenders.push(`${route.id}:${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('claims every enabled tab from an enabled record landing', () => {
    const claimed = new Set(
      ROUTE_REGISTRY.filter((route) => route.enabled && route.kind === 'record-landing')
        .flatMap((route) => route.tabIds),
    );
    const orphans = ENABLED_TABS.map((route) => route.id).filter((id) => !claimed.has(id));
    expect(orphans).toEqual([]);
  });
});
