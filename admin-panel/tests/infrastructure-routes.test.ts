import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';

function route(routeId: RouteId): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((item) => item.id === routeId);
  if (!descriptor) throw new Error(`Missing test route: ${routeId}`);
  return descriptor;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

describe('Infrastructure target registry', () => {
  it('enables the approved four routes in order', () => {
    expect(buildRoute('en', 'infrastructure.deployments')).toBe('/en/infrastructure/deployments');
    expect(buildRoute('en', 'infrastructure.containers')).toBe('/en/infrastructure/containers');
    expect(buildRoute('en', 'infrastructure.resources')).toBe('/en/infrastructure/resources');
    expect(buildRoute('en', 'infrastructure.ranking')).toBe('/en/infrastructure/ranking');
    for (const id of [
      'infrastructure.deployments',
      'infrastructure.containers',
      'infrastructure.resources',
      'infrastructure.ranking',
    ] as const) expect(route(id).enabled).toBe(true);
  });

  it('requires Container list and read for route-required frame data', () => {
    const containers = route('infrastructure.containers');
    expect(isRoutePermitted(containers, new Set(['container:list']))).toBe(false);
    expect(isRoutePermitted(containers, new Set(['container:list', 'container:read']))).toBe(true);
  });

  it('keeps Ranking all-of because page and registry already agree', () => {
    const ranking = route('infrastructure.ranking');
    expect(isRoutePermitted(ranking, new Set(['ranking:list']))).toBe(false);
    expect(isRoutePermitted(ranking, new Set(['ranking:read']))).toBe(false);
    expect(isRoutePermitted(ranking, new Set(['ranking:list', 'ranking:read']))).toBe(true);
  });
});

describe('Infrastructure legacy redirects', () => {
  it('redirects permitted direct paths', () => {
    expect(resolveLegacyRedirect('th', '/deployments', new Set(['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'])))
      .toBe('/th/infrastructure/deployments');
    expect(resolveLegacyRedirect('th', '/containers', new Set(['container:list', 'container:read'])))
      .toBe('/th/infrastructure/containers');
    expect(resolveLegacyRedirect('th', '/resources', new Set(['resource:list', 'resource:read'])))
      .toBe('/th/infrastructure/resources');
    expect(resolveLegacyRedirect('th', '/ranking', new Set(['ranking:list', 'ranking:read'])))
      .toBe('/th/infrastructure/ranking');
  });

  it('uses Deployments, Containers, Resources, Ranking fallback order', () => {
    expect(resolveLegacyRedirect('en', '/containers', new Set(['resource:list', 'resource:read'])))
      .toBe('/en/infrastructure/resources');
    expect(resolveLegacyRedirect('en', '/containers', new Set())).toBeNull();
  });
});

describe('Infrastructure ownership and wiring', () => {
  it.each([
    [
      'src/app/[locale]/(authenticated)/infrastructure/deployments/page.tsx',
      'infrastructure.deployments',
      '<DeploymentsClient',
    ],
    [
      'src/app/[locale]/(authenticated)/infrastructure/containers/page.tsx',
      'infrastructure.containers',
      '<ContainersClient',
    ],
    [
      'src/app/[locale]/(authenticated)/infrastructure/resources/page.tsx',
      'infrastructure.resources',
      '<ResourceView',
    ],
    [
      'src/app/[locale]/(authenticated)/infrastructure/ranking/page.tsx',
      'infrastructure.ranking',
      '<RankingClient',
    ],
  ])('%s authorizes and delegates to %s', (relativePath, routeId, clientTag) => {
    const source = readSource(relativePath);
    expect(source).toContain(`authorizeRoutePage('${routeId}')`);
    expect(source).toContain('getDictionary(locale)');
    expect(source).toContain(clientTag);
    expect(source).not.toContain('<PageSurface');
    expect(source).not.toContain('InfrastructureClient');
  });

  it('keeps stream URLs and density wiring in their feature owners', () => {
    expect(readSource('src/components/containers/useContainersController.ts'))
      .toContain("url: '/api/containers/stream'");
    const resources = readSource('src/components/resources/ResourceView.tsx');
    expect(resources).toContain('url: `/api/resources/stream?trafficLimit=${trafficLimit}`');
    expect(resources).toContain('density:space-y-4');
  });
});
