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

describe('System target registry', () => {
  it('enables four independent routes', () => {
    expect(buildRoute('en', 'system.appearance')).toBe('/en/system/appearance');
    expect(buildRoute('en', 'system.maintenance')).toBe('/en/system/maintenance');
    expect(buildRoute('en', 'system.settings')).toBe('/en/system/settings');
    expect(buildRoute('en', 'system.docs')).toBe('/en/system/docs');
    for (const id of [
      'system.appearance',
      'system.maintenance',
      'system.settings',
      'system.docs',
    ] as const) expect(route(id).enabled).toBe(true);
  });

  it('keeps Appearance read+list, Maintenance any-of, Settings read+list, and Docs public', () => {
    const appearance = route('system.appearance');
    expect(isRoutePermitted(appearance, new Set(['appearance:read']))).toBe(false);
    expect(isRoutePermitted(appearance, new Set(['appearance:list']))).toBe(false);
    expect(isRoutePermitted(appearance, new Set(['appearance:read', 'appearance:list']))).toBe(true);
    expect(isRoutePermitted(appearance, new Set(['appearance:read', 'appearance:list', 'appearance:update']))).toBe(true);
    const maintenance = route('system.maintenance');
    expect(isRoutePermitted(maintenance, new Set(['maintenance:update']))).toBe(true);
    expect(isRoutePermitted(maintenance, new Set(['backup:create']))).toBe(true);
    expect(isRoutePermitted(maintenance, new Set(['settings:update']))).toBe(false);
    const settings = route('system.settings');
    expect(isRoutePermitted(settings, new Set(['env:read', 'env:list']))).toBe(false);
    expect(isRoutePermitted(settings, new Set(['monitor:read', 'monitor:list']))).toBe(false);
    expect(isRoutePermitted(settings, new Set(['env:read', 'env:list', 'monitor:read', 'monitor:list']))).toBe(true);
    expect(isRoutePermitted(settings, new Set(['settings:update']))).toBe(false);
    expect(isRoutePermitted(route('system.docs'), new Set())).toBe(true);
  });
});

describe('System redirects', () => {
  it('uses the group order for fallbacks and never falls back to public Docs', () => {
    // Why null, not Docs: a requirement-free route is admitted for every caller,
    // so admitting it as a fallback would answer a denied legacy path for a
    // reader who holds no System key at all. A keyless caller is concealed
    // instead; /docs still resolves directly.
    expect(resolveLegacyRedirect('th', '/maintenance', new Set())).toBeNull();
    expect(resolveLegacyRedirect('th', '/docs', new Set())).toBe('/th/system/docs');
    expect(resolveLegacyRedirect('en', '/appearance', new Set(['env:read', 'env:list', 'monitor:read', 'monitor:list'])))
      .toBe('/en/system/settings');
    expect(resolveLegacyRedirect('en', '/settings', new Set(['backup:create'])))
      .toBe('/en/system/maintenance');
  });
});

describe('System physical pages authorize and delegate', () => {
  it.each([
    [
      'src/app/[locale]/(authenticated)/system/appearance/page.tsx',
      'system.appearance',
      ['<AppearanceClient'],
    ],
    [
      'src/app/[locale]/(authenticated)/system/maintenance/page.tsx',
      'system.maintenance',
      ['<MaintenanceClient'],
    ],
    [
      'src/app/[locale]/(authenticated)/system/settings/page.tsx',
      'system.settings',
      ['<EnvConfigView', '<MonitorConfigSection'],
    ],
    [
      'src/app/[locale]/(authenticated)/system/docs/page.tsx',
      null,
      ['<DocsContent'],
    ],
  ])('%s delegates to its feature owner', (
    relativePath: string,
    routeId: string | null,
    clientTags: readonly string[],
  ) => {
    const source = readSource(relativePath);
    if (routeId !== null) {
      expect(source).toContain(`authorizeRoutePage('${routeId}')`);
    }
    for (const clientTag of clientTags) expect(source).toContain(clientTag);
  });

  it.each([
    'src/app/[locale]/(authenticated)/system/appearance/page.tsx',
    'src/app/[locale]/(authenticated)/system/maintenance/page.tsx',
    'src/app/[locale]/(authenticated)/system/settings/page.tsx',
    'src/app/[locale]/(authenticated)/system/docs/page.tsx',
    'src/app/[locale]/(authenticated)/system/layout.tsx',
  ])('%s resolves localized labels with getDictionary(locale)', (relativePath) => {
    expect(readSource(relativePath)).toContain('getDictionary(locale)');
  });

  it('keeps Branding, Services, Display local and URL-stable', () => {
    const page = readSource('src/app/[locale]/(authenticated)/system/appearance/page.tsx');
    const client = readSource('src/components/appearance/AppearanceClient.tsx');
    expect(page).not.toContain('searchParams');
    expect(client).toContain("useState<TabKey>('branding')");
    expect(client).toContain("{ key: 'branding', label: 'Branding' }");
    expect(client).toContain("{ key: 'services', label: 'Services' }");
    expect(client).toContain("{ key: 'display', label: 'Display' }");
    expect(client).not.toContain('useSearchParams');
  });
});
