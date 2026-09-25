import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';

import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { EXPECTED_NAVIGATION_GROUPS, EXPECTED_ROUTE_MANIFEST, EXPECTED_ROUTE_PERMISSIONS } from './fixtures/admin-panel-routes';

const ROOT = join(__dirname, '..');
const UI_DIR = join(ROOT, 'src/components/ui');
const SURFACE_FILES = [
  'src/components/core/SurfaceHeader.tsx',
  'src/components/core/SurfaceTabs.tsx',
  'src/components/core/SurfaceState.tsx',
  'src/components/core/PageSurface.tsx',
  'src/components/core/DetailSurface.tsx',
] as const;

const ACTIVE_SHELL_FILES = [
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/FullScreenNavOverlay.tsx',
  'src/components/layout/MobileBottomBar.tsx',
  'src/components/palette/CommandPalette.tsx',
] as const;

const DIRECT_ROUTE_CASES = [
  {
    routeId: 'home',
    physicalPath: 'src/app/[locale]/(authenticated)/page.tsx',
    pageLabelKey: 'dict.dashboard.welcome',
  },
  {
    routeId: 'contests.list',
    physicalPath: 'src/app/[locale]/(authenticated)/contests/page.tsx',
    pageLabelKey: 'dict.contests.title',
  },
  {
    routeId: 'tasks.list',
    physicalPath: 'src/app/[locale]/(authenticated)/tasks/page.tsx',
    pageLabelKey: 'dict.tasks.title',
  },
] as const;

const DIRECT_LABEL_CASES = [
  { labelKey: 'navigation.groups.direct', en: 'Direct', th: 'การแข่งขัน' },
  { labelKey: 'navigation.home.label', en: 'Dashboard', th: 'แดชบอร์ด' },
  { labelKey: 'navigation.contests.list.label', en: 'Contests', th: 'การแข่งขัน' },
  { labelKey: 'navigation.tasks.list.label', en: 'Tasks', th: 'งาน' },
] as const;

function resolveGeneratedLabel(dictionary: unknown, labelKey: string): string {
  let current: unknown = dictionary;
  for (const segment of labelKey.split('.')) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`Missing dictionary key: ${labelKey}`);
    }
    current = Reflect.get(current, segment);
  }
  if (typeof current !== 'string') throw new Error(`Dictionary key is not a label: ${labelKey}`);
  return current;
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe('route-manifest fixture parity', () => {
  it('matches every target ID, pattern, kind, relationship, and legacy path', () => {
    const actual = ROUTE_REGISTRY.map((route) => ({
      id: route.id,
      path: route.path,
      kind: route.kind,
      ...(route.parentId ? { parentId: route.parentId } : {}),
      ...(route.defaultChildId ? { defaultChildId: route.defaultChildId } : {}),
      tabIds: route.tabIds,
      legacyPaths: route.legacyPaths,
      enabled: route.enabled,
    }));
    expect(actual).toEqual(EXPECTED_ROUTE_MANIFEST);
  });

  it('matches the exact read permission requirement for every descriptor', () => {
    const actualPermissions = Object.fromEntries(
      ROUTE_REGISTRY.map((route) => [route.id, route.permission]),
    );
    expect(actualPermissions).toEqual(EXPECTED_ROUTE_PERMISSIONS);
  });

  it('matches the approved group order and membership', () => {
    expect(NAVIGATION_GROUPS).toEqual(EXPECTED_NAVIGATION_GROUPS);
  });
});

describe('component import direction', () => {
  it('keeps ui adapters from importing public core policy', () => {
    for (const file of sourceFiles(UI_DIR)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"]@\/components\/core\//);
    }
  });

  it('keeps the new surfaces on existing core primitives', () => {
    for (const relativePath of SURFACE_FILES) {
      const source = read(relativePath);
      expect(source).not.toContain("from '@/components/ui/");
    }
  });
});

describe('surface non-ownership', () => {
  it('does not import app, feature, service, auth, permission, or mutation modules', () => {
    const forbidden = [
      /from ['"]@\/app\//,
      /from ['"]@\/components\/(admins|appearance|audit|containers|contests|deployments|docs|groups|palette|ranking|resources|settings|users|submissions|tasks|teams)\//,
      /from ['"]@\/lib\/services\//,
      /from ['"]@\/lib\/server\/authorization['"]/,
      /\b(getSession|getFreshPermissions|getPermissions|ensurePermission|requirePermission)\s*\(/,
      /\bfetch\s*\(/,
    ];

    for (const relativePath of SURFACE_FILES) {
      const source = read(relativePath);
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    }
  });

  it('contains no entity-specific public prop names', () => {
    const forbiddenProps = [
      'contestId',
      'taskId',
      'userId',
      'teamId',
      'submissionId',
      'permissionKeys',
      'capabilities',
      'initialData',
      'entity',
      'onCreate',
      'onDelete',
    ];
    for (const relativePath of SURFACE_FILES) {
      const source = read(relativePath);
      for (const prop of forbiddenProps) expect(source).not.toContain(prop);
    }
  });

  it('keeps every new file at or below 250 lines', () => {
    for (const relativePath of SURFACE_FILES) {
      expect(read(relativePath).split('\n').length).toBeLessThanOrEqual(250);
    }
    for (const relativePath of [
      'src/lib/navigation/types.ts',
      'src/lib/navigation/registry.ts',
      'src/lib/navigation/permissions.ts',
      'src/lib/navigation/routes.ts',
      'src/lib/navigation/redirects.ts',
    ]) {
      expect(read(relativePath).split('\n').length).toBeLessThanOrEqual(250);
    }
  });
});

describe('foundation cutover state', () => {
  it('resolves all four direct bilingual labels before enablement', () => {
    for (const label of DIRECT_LABEL_CASES) {
      const english = resolveGeneratedLabel(en, label.labelKey);
      const thai = resolveGeneratedLabel(th, label.labelKey);
      expect(english).toBe(label.en);
      expect(thai).toBe(label.th);
      expect(english.trim()).not.toBe('');
      expect(thai.trim()).not.toBe('');
    }
  });

  it('enables the direct three plus the Contest record and tabs after Task 2', () => {
    for (const directRoute of DIRECT_ROUTE_CASES) {
      const physicalPath = join(ROOT, directRoute.physicalPath);
      expect(existsSync(physicalPath), directRoute.physicalPath).toBe(true);
      const pageSource = read(directRoute.physicalPath);
      expect(pageSource).toContain('getDictionary(locale)');
      expect(pageSource).toContain(directRoute.pageLabelKey);
    }
    // Why: Task 2 proved the physical Contest routes, so the record landing
    // and its five tabs join the direct three in registry order — every other
    // migration descriptor stays disabled until its own task proves its routes.
    const enabledIds = [
      'home',
      'contests.list',
      'contests.record',
      'contests.tabs.overview',
      'contests.tabs.tasks',
      'contests.tabs.participants',
      'contests.tabs.communications',
      'contests.tabs.settings',
      'tasks.list',
    ];
    const enabledIdSet = new Set<string>(enabledIds);
    expect(ROUTE_REGISTRY.filter((route) => route.enabled).map((route) => route.id)).toEqual(enabledIds);
    expect(ROUTE_REGISTRY.filter((route) => !enabledIdSet.has(route.id)).every((route) => !route.enabled)).toBe(true);
  });

  it('keeps Sidebar, palette, and mobile on the old registry', () => {
    for (const relativePath of ACTIVE_SHELL_FILES) {
      const source = read(relativePath);
      expect(source).toContain("@/lib/nav-registry");
      expect(source).not.toContain("@/lib/navigation/registry");
    }
  });

  it('does not add a standalone Permissions target route', () => {
    expect(ROUTE_REGISTRY.some((route) => route.path === '/permissions')).toBe(false);
    expect(NAVIGATION_GROUPS.some((group) =>
      group.routeIds.some((routeId) => routeId.includes('permissions')),
    )).toBe(false);
  });
});
