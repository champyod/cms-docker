import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ADMINISTRATION_ROUTE_IDS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';

const mocks = vi.hoisted(() => ({ docsEnabled: false }));

// Why patch the registry: system.docs is the only requirement-free module route
// and it is still disabled, so the fallback rule can only be exercised against it
// by enabling it here. The factory re-runs after vi.resetModules(), which is what
// lets resolveLegacyRedirect rebuild its id-to-descriptor map with Docs enabled.
vi.mock('@/lib/navigation/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/navigation/registry')>();
  return {
    ...actual,
    ROUTE_REGISTRY: mocks.docsEnabled
      ? actual.ROUTE_REGISTRY.map((descriptor) =>
          descriptor.id === 'system.docs' ? { ...descriptor, enabled: true } : descriptor,
        )
      : actual.ROUTE_REGISTRY,
  };
});

async function resolveWithDocsEnabled(
  legacyPath: string,
  effective: ReadonlySet<string>,
): Promise<string | null> {
  mocks.docsEnabled = true;
  vi.resetModules();
  const fresh = await import('@/lib/navigation/redirects');
  return fresh.resolveLegacyRedirect('th', legacyPath, effective);
}

function route(routeId: RouteId): RouteDescriptor {
  const descriptor = ROUTE_REGISTRY.find((item) => item.id === routeId);
  if (!descriptor) throw new Error(`Missing test route: ${routeId}`);
  return descriptor;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

describe('Administration target registry', () => {
  it('enables exactly the three Administration pages in order', () => {
    expect(ADMINISTRATION_ROUTE_IDS).toEqual([
      'administration.admins',
      'administration.groups',
      'administration.audit',
    ]);
    expect(ADMINISTRATION_ROUTE_IDS.map((id) => route(id).enabled)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('has no standalone Permissions descriptor', () => {
    expect(ROUTE_REGISTRY.some((item) => item.path === '/permissions')).toBe(false);
    expect(ROUTE_REGISTRY.some((item) => item.id.includes('permissions'))).toBe(false);
  });

  it('matches Audit visibility to route-required data', () => {
    const audit = route('administration.audit');
    expect(isRoutePermitted(audit, new Set(['audit:list']))).toBe(false);
    expect(
      isRoutePermitted(audit, new Set(['audit:list', 'audit:read'])),
    ).toBe(true);
  });
});

describe('Administration legacy redirects', () => {
  it('defaults to Admins, then Groups, then Audit', () => {
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['audit:list', 'audit:read'])))
      .toBe('/th/administration/audit');
    expect(resolveLegacyRedirect('en', '/permissions', new Set(['group:list', 'group:read'])))
      .toBe('/en/administration/groups');
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['admin:list', 'admin:read'])))
      .toBe('/th/administration/admins');
  });

  it('honors permitted query tabs and falls back when denied', () => {
    expect(resolveLegacyRedirect('th', '/permissions?tab=groups', new Set(['group:list', 'group:read'])))
      .toBe('/th/administration/groups');
    expect(resolveLegacyRedirect('th', '/permissions?tab=admins', new Set(['group:list', 'group:read'])))
      .toBe('/th/administration/groups');
    expect(resolveLegacyRedirect('th', '/permissions?tab=groups', new Set(['admin:list', 'admin:read'])))
      .toBe('/th/administration/admins');
  });

  it('redirects direct legacy paths and conceals denied targets', () => {
    expect(resolveLegacyRedirect('en', '/admins', new Set(['admin:list', 'admin:read'])))
      .toBe('/en/administration/admins');
    expect(resolveLegacyRedirect('en', '/groups', new Set(['group:list', 'group:read'])))
      .toBe('/en/administration/groups');
    expect(resolveLegacyRedirect('en', '/audit', new Set(['audit:read', 'audit:list'])))
      .toBe('/en/administration/audit');
    expect(resolveLegacyRedirect('en', '/admins', new Set(['settings:update'])))
      .toBeNull();
  });

  it('preserves locale through the foundation builder', () => {
    expect(buildRoute('th', 'administration.groups')).toBe('/th/administration/groups');
  });

  it('falls back only inside the route own navigation group', () => {
    expect(resolveLegacyRedirect('th', '/admins', new Set(['task:list']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/users', new Set(['team:list']))).toBe(
      '/th/people/teams',
    );
    expect(resolveLegacyRedirect('th', '/submissions', new Set(['evaluation:list']))).toBe(
      '/th/evaluation/lanes',
    );
  });

  it('conceals a group whose members are all disabled or denied', () => {
    expect(resolveLegacyRedirect('th', '/deployments', new Set(['task:list']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/appearance', new Set(['task:list']))).toBeNull();
  });
});

describe('requirement-free route is never a fallback target', () => {
  const DOCS_ID = 'system.docs';

  it('declares no permission requirement on the open System route', () => {
    const docs = route(DOCS_ID);
    expect(docs.permission.all ?? []).toEqual([]);
    expect(docs.permission.any ?? []).toEqual([]);
  });

  it('keeps a denied System legacy path concealed while Docs is disabled', () => {
    expect(resolveLegacyRedirect('th', '/appearance', new Set(['task:list']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/maintenance', new Set(['task:list']))).toBeNull();
  });

  it('never redirects a denied System legacy path to Docs once Docs is enabled', async () => {
    for (const legacyPath of ['/appearance', '/maintenance', '/settings']) {
      expect(await resolveWithDocsEnabled(legacyPath, new Set(['task:list']))).toBeNull();
    }
  });

  it('still resolves the open Docs route as a direct legacy target', async () => {
    expect(await resolveWithDocsEnabled('/docs', new Set(['task:list'])))
      .toBe('/th/system/docs');
  });

  it('prefers a readable gated System route over the open Docs route', async () => {
    expect(
      await resolveWithDocsEnabled('/appearance', new Set(['appearance:read', 'appearance:list'])),
    ).toBe('/th/system/appearance');
  });
});

describe('Administration physical pages authorize and delegate', () => {
  it.each([
    [
      'src/app/[locale]/(authenticated)/administration/admins/page.tsx',
      'administration.admins',
      '<AdminList',
    ],
    [
      'src/app/[locale]/(authenticated)/administration/groups/page.tsx',
      'administration.groups',
      '<GroupList',
    ],
    [
      'src/app/[locale]/(authenticated)/administration/audit/page.tsx',
      'administration.audit',
      '<AuditTable',
    ],
  ])('%s calls %s and delegates to %s', (relativePath, routeId, clientTag) => {
    const source = readSource(relativePath);
    expect(source).toContain(`authorizeRoutePage('${routeId}')`);
    expect(source).toContain('getDictionary(locale)');
    expect(source).not.toMatch(/checkPermission\(/);
    expect(source).toContain(clientTag);
  });
});
