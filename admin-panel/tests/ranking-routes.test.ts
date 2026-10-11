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

// Route, physical page, and the server action or component the page must delegate to.
const RANKING_PAGES: readonly [RouteId, string, string][] = [
  ['ranking.board', 'src/app/[locale]/(authenticated)/ranking/page.tsx', '<RankingLogoCard'],
  ['ranking.appearance', 'src/app/[locale]/(authenticated)/ranking/appearance/page.tsx', 'submitRankingAppearance'],
  ['ranking.settings', 'src/app/[locale]/(authenticated)/ranking/settings/page.tsx', 'saveRankingOverride'],
  ['ranking.lockouts', 'src/app/[locale]/(authenticated)/ranking/lockouts/page.tsx', 'clearRankingLockout'],
  ['ranking.credits', 'src/app/[locale]/(authenticated)/ranking/credits/page.tsx', 'submitRankingCredits'],
];

describe('Ranking target registry', () => {
  it('enables the five sub-routes with their canonical paths', () => {
    expect(buildRoute('en', 'ranking.board')).toBe('/en/ranking');
    expect(buildRoute('en', 'ranking.settings')).toBe('/en/ranking/settings');
    expect(buildRoute('en', 'ranking.appearance')).toBe('/en/ranking/appearance');
    expect(buildRoute('en', 'ranking.lockouts')).toBe('/en/ranking/lockouts');
    expect(buildRoute('en', 'ranking.credits')).toBe('/en/ranking/credits');
    for (const [routeId] of RANKING_PAGES) expect(route(routeId).enabled).toBe(true);
  });

  it('keeps every ranking page all-of on list and read', () => {
    for (const [routeId] of RANKING_PAGES) {
      const descriptor = route(routeId);
      expect(isRoutePermitted(descriptor, new Set(['ranking:list']))).toBe(false);
      expect(isRoutePermitted(descriptor, new Set(['ranking:read']))).toBe(false);
      expect(isRoutePermitted(descriptor, new Set(['ranking:list', 'ranking:read']))).toBe(true);
    }
  });

  it('claims only the old address as a legacy path, on the board', () => {
    const legacyPaths = RANKING_PAGES.flatMap(([routeId]) => route(routeId).legacyPaths);
    expect(legacyPaths).toEqual(['/infrastructure/ranking']);
    expect(resolveLegacyRedirect('th', '/infrastructure/ranking', new Set(['ranking:list', 'ranking:read'])))
      .toBe('/th/ranking');
    expect(resolveLegacyRedirect('th', '/ranking', new Set(['ranking:list', 'ranking:read']))).toBeNull();
  });
});

describe('Ranking ownership and wiring', () => {
  it.each(RANKING_PAGES)('%s authorizes its own route and delegates to its action', (routeId, relativePath, tag) => {
    const source = readSource(relativePath);
    expect(source).toContain(`authorizeRoutePage('${routeId}')`);
    // The trail and header belong to the group layout, so a page that built them
    // would duplicate the shell's own row.
    expect(source).not.toContain('listBreadcrumbs');
    expect(source).toContain(tag);
  });

  it('keeps the credit list out of the appearance form so neither can clear the other', () => {
    const appearance = readSource('src/app/[locale]/(authenticated)/ranking/appearance/page.tsx');
    expect(appearance).not.toContain('name="credits"');
    const credits = readSource('src/app/[locale]/(authenticated)/ranking/credits/page.tsx');
    expect(credits).toContain('name="credits"');
    expect(credits).toContain('submitRankingCredits');
  });

  it('keeps the old address a redirect stub rather than a second page', () => {
    const source = readSource('src/app/[locale]/(authenticated)/infrastructure/ranking/page.tsx');
    expect(source).toContain("const LEGACY_PATH = '/infrastructure/ranking'");
    expect(source).not.toContain('authorizeRoutePage');
  });
});
