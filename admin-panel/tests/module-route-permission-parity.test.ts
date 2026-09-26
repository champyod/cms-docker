import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';

const ROUTE_CASES = [
  {
    routeId: 'administration.admins',
    requiredKeys: ['admin:list', 'admin:read'],
  },
  {
    routeId: 'administration.groups',
    requiredKeys: ['group:list', 'group:read'],
  },
  {
    routeId: 'administration.audit',
    requiredKeys: ['audit:list', 'audit:read'],
  },
  {
    routeId: 'infrastructure.deployments',
    requiredKeys: [
      'deployment:list',
      'deployment:read',
      'env:read',
      'env:list',
      'contest:list',
      'container:read',
      'settings:read',
      'settings:list',
      'task:read',
    ],
  },
  {
    routeId: 'infrastructure.containers',
    requiredKeys: ['container:list', 'container:read'],
  },
  {
    routeId: 'infrastructure.resources',
    requiredKeys: ['resource:list', 'resource:read'],
  },
  {
    routeId: 'infrastructure.ranking',
    requiredKeys: ['ranking:list', 'ranking:read'],
  },
  {
    routeId: 'system.appearance',
    requiredKeys: ['appearance:read', 'appearance:list'],
  },
  {
    routeId: 'system.settings',
    requiredKeys: ['env:read', 'env:list', 'monitor:read', 'monitor:list'],
  },
  {
    routeId: 'system.docs',
    requiredKeys: [],
  },
] as const satisfies readonly { routeId: RouteId; requiredKeys: readonly string[] }[];

const MODULE_ROUTE_IDS = [
  'administration.admins',
  'administration.groups',
  'administration.audit',
  'infrastructure.deployments',
  'infrastructure.containers',
  'infrastructure.resources',
  'infrastructure.ranking',
  'system.appearance',
  'system.maintenance',
  'system.settings',
  'system.docs',
] as const satisfies readonly RouteId[];

function routePermits(routeId: RouteId, effective: ReadonlySet<string>): boolean {
  const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
  if (!descriptor) throw new Error(`Missing route descriptor: ${routeId}`);
  return isRoutePermitted(descriptor, effective);
}

describe('module tab and route permission parity', () => {
  it.each(ROUTE_CASES)(
    '$routeId authorizes the complete reader set and conceals every partial set',
    ({ routeId, requiredKeys }) => {
      expect(routePermits(routeId, new Set(requiredKeys))).toBe(true);
      for (const missingKey of requiredKeys) {
        const partialKeys = requiredKeys.filter((key) => key !== missingKey);
        expect(routePermits(routeId, new Set(partialKeys))).toBe(false);
      }
    },
  );

  it('keeps system.maintenance as a separate any-of route gate', () => {
    expect(routePermits('system.maintenance', new Set(['maintenance:update']))).toBe(true);
    expect(routePermits('system.maintenance', new Set(['backup:create']))).toBe(true);
    expect(routePermits('system.maintenance', new Set())).toBe(false);
    expect(routePermits('system.maintenance', new Set(['maintenance:enable']))).toBe(false);
    expect(routePermits('system.maintenance', new Set(['settings:update']))).toBe(false);
  });

  it('keeps action permissions separate from route visibility', () => {
    expect(routePermits('administration.admins', new Set(['admin:create']))).toBe(false);
    expect(routePermits('administration.groups', new Set(['group:assign']))).toBe(false);
    expect(routePermits('infrastructure.deployments', new Set(['deployment:deploy']))).toBe(false);
    expect(routePermits('infrastructure.containers', new Set(['container:control']))).toBe(false);
    expect(routePermits('infrastructure.ranking', new Set(['ranking:snapshot']))).toBe(false);
    expect(routePermits('system.appearance', new Set(['appearance:update']))).toBe(false);
    expect(routePermits('system.settings', new Set(['settings:update']))).toBe(false);
    expect(routePermits('system.maintenance', new Set(['maintenance:enable']))).toBe(false);
  });

  it('declares every module group route the layouts will consume', () => {
    const declaredIds = ROUTE_REGISTRY.map((route) => route.id);
    for (const routeId of MODULE_ROUTE_IDS) {
      expect(declaredIds).toContain(routeId);
    }
  });
});
