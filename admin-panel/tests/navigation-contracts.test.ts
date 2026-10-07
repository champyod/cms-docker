import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_ROUTE_IDS,
  NAVIGATION_GROUPS,
  ROUTE_REGISTRY,
  visibleRoutes,
} from '@/lib/navigation/registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import { buildRoute } from '@/lib/navigation/routes';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';

function routeWith(
  permission: RouteDescriptor['permission'],
): RouteDescriptor {
  return {
    id: 'home',
    path: '/',
    kind: 'page',
    permission,
    labelKey: 'navigation.home.label',
    legacyPaths: [],
    tabIds: [],
    surfaces: ['sidebar'],
    enabled: true,
  };
}

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

const DIRECT_ROUTE_CASES = [
  {
    routeId: 'home',
    physicalPath: 'src/app/[locale]/(authenticated)/page.tsx',
    pageLabelKey: 'dict.dashboard.welcome',
    targetLabelKey: 'navigation.home.label',
  },
  {
    routeId: 'contests.list',
    physicalPath: 'src/app/[locale]/(authenticated)/contests/page.tsx',
    pageLabelKey: 'dict.contests.title',
    targetLabelKey: 'navigation.contests.list.label',
  },
  {
    routeId: 'tasks.list',
    physicalPath: 'src/app/[locale]/(authenticated)/tasks/page.tsx',
    pageLabelKey: 'dict.tasks.title',
    targetLabelKey: 'navigation.tasks.list.label',
  },
] as const;

const DIRECT_LABEL_CASES = [
  { labelKey: 'navigation.groups.direct', en: 'Direct', th: 'การแข่งขัน' },
  { labelKey: 'navigation.home.label', en: 'Dashboard', th: 'แดชบอร์ด' },
  { labelKey: 'navigation.contests.list.label', en: 'Contests', th: 'การแข่งขัน' },
  { labelKey: 'navigation.tasks.list.label', en: 'Tasks', th: 'งาน' },
] as const;

// Why one id and not the group: a module contributes a single sidebar entry, the
// landing page its tab strip opens on, while its remaining routes stay reachable
// as tabs and from the palette, the search page, and the shortcut chords.
const ADMINISTRATION_LANDING_ROUTE_ID: RouteId = 'administration.admins';

const INFRASTRUCTURE_LANDING_ROUTE_ID: RouteId = 'infrastructure.deployments';

const SYSTEM_LANDING_ROUTE_ID: RouteId = 'system.appearance';

const INFRASTRUCTURE_ROUTE_IDS = [
  'infrastructure.deployments',
  'infrastructure.containers',
  'infrastructure.resources',
  'infrastructure.ranking',
] as const satisfies readonly RouteId[];

const SYSTEM_ROUTE_IDS = [
  'system.appearance',
  'system.maintenance',
  'system.backup-restore',
  'system.settings',
  'system.docs',
  'system.about',
] as const satisfies readonly RouteId[];

function tabIdsVisibleTo(effective: ReadonlySet<string>): string[] {
  return ROUTE_REGISTRY
    .filter((route) => route.kind === 'nested-tab')
    .filter((route) => isRoutePermitted({ ...route, enabled: true }, effective))
    .map((route) => route.id);
}

describe('target route registry', () => {
  it('proves the existing direct physical routes and label contracts', () => {
    for (const directRoute of DIRECT_ROUTE_CASES) {
      const physicalPath = join(process.cwd(), directRoute.physicalPath);
      expect(existsSync(physicalPath), directRoute.physicalPath).toBe(true);
      const pageSource = readFileSync(physicalPath, 'utf8');
      expect(pageSource).toContain('getDictionary(locale)');
      expect(pageSource).toContain(directRoute.pageLabelKey);
      const descriptor = ROUTE_REGISTRY.find((route) => route.id === directRoute.routeId);
      expect(descriptor?.labelKey).toBe(directRoute.targetLabelKey);
    }
  });

  it('resolves all four generated direct labels bilingually before enablement', () => {
    for (const label of DIRECT_LABEL_CASES) {
      const english = resolveGeneratedLabel(en, label.labelKey);
      const thai = resolveGeneratedLabel(th, label.labelKey);
      expect(english).toBe(label.en);
      expect(thai).toBe(label.th);
      expect(english.trim()).not.toBe('');
      expect(thai.trim()).not.toBe('');
    }
  });

  it('enables the direct three plus the Contest, Task, User, Team, and Evaluation routes', () => {
    expect(ROUTE_REGISTRY).toHaveLength(46);
    const directIds = DIRECT_ROUTE_CASES.map(({ routeId }) => routeId);
    // Why: the Evaluation shell proves the Submission list, the lane module, and
    // the Submission record landing with its four tabs, and the Administration
    // and System groups prove Admins, Groups, Audit, Appearance, Maintenance,
    // Settings, and Docs, so those descriptors join the direct three and the
    // Contest, Task, User, and Team routes in registry order.
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
      'tasks.record',
      'tasks.tabs.overview',
      'tasks.tabs.datasets',
      'tasks.tabs.files',
      'tasks.tabs.settings',
      'people.users',
      'people.user-record',
      'people.user-tabs.profile',
      'people.user-tabs.teams',
      'people.user-tabs.history',
      'people.teams',
      'people.team-record',
      'people.team-tabs.overview',
      'people.team-tabs.members',
      'people.team-tabs.contests',
      'evaluation.submissions',
      'evaluation.submission-record',
      'evaluation.submission-tabs.summary',
      'evaluation.submission-tabs.results',
      'evaluation.submission-tabs.logs',
      'evaluation.submission-tabs.evaluation',
      'evaluation.lanes',
      ...ADMINISTRATION_ROUTE_IDS,
      ...INFRASTRUCTURE_ROUTE_IDS,
      ...SYSTEM_ROUTE_IDS,
      'system.search',
    ];
    const enabledIdSet = new Set<string>(enabledIds);
    expect(ROUTE_REGISTRY.filter((route) => route.enabled).map((route) => route.id)).toEqual(enabledIds);
    expect(ROUTE_REGISTRY.filter((route) => !enabledIdSet.has(route.id)).every((route) => !route.enabled)).toBe(true);
    // Why: page surfaces are group-scoped, so the sidebar equality is scoped to
    // the module IDs this registry owns — a People or Evaluation entry owned by
    // another slice would otherwise make the complete visible list look
    // incomplete.
    const sidebarIds = visibleRoutes(new Set(['all:all']), 'sidebar').map((route) => route.id);
    expect(sidebarIds.slice(0, directIds.length)).toEqual(directIds);
    const moduleIds = new Set<RouteId>([
      ...ADMINISTRATION_ROUTE_IDS,
      ...INFRASTRUCTURE_ROUTE_IDS,
      ...SYSTEM_ROUTE_IDS,
    ]);
    expect(sidebarIds.filter((id) => moduleIds.has(id))).toEqual([
      ADMINISTRATION_LANDING_ROUTE_ID,
      INFRASTRUCTURE_LANDING_ROUTE_ID,
      SYSTEM_LANDING_ROUTE_ID,
    ]);
  });

  it('uses stable unique IDs and unique canonical patterns', () => {
    const ids = ROUTE_REGISTRY.map((route) => route.id);
    const paths = ROUTE_REGISTRY.map((route) => route.path);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id))).toBe(true);
    expect(
      paths.every(
        (path) =>
          path === '/' ||
          path
            .split('/')
            .slice(1)
            .every((segment) => /^(?:[a-z0-9_-]+|\[[a-z0-9_-]+\])$/.test(segment)),
      ),
    ).toBe(true);
  });

  it('has valid parent, default-child, and tab relationships', () => {
    const byId = new Map(ROUTE_REGISTRY.map((route) => [route.id, route]));
    for (const route of ROUTE_REGISTRY) {
      if (route.parentId) expect(byId.get(route.parentId)).toBeDefined();
      if (route.defaultChildId) {
        expect(route.tabIds).toContain(route.defaultChildId);
        expect(byId.get(route.defaultChildId)?.parentId).toBe(route.id);
      }
      for (const tabId of route.tabIds) {
        expect(byId.get(tabId)?.parentId).toBe(route.id);
        expect(byId.get(tabId)?.kind).toBe('nested-tab');
      }
    }
  });

  it('declares only Admins, Groups, and Audit under Administration', () => {
    expect(ADMINISTRATION_ROUTE_IDS).toEqual([
      'administration.admins',
      'administration.groups',
      'administration.audit',
    ]);
    expect(ROUTE_REGISTRY.some((route) => route.id.includes('permissions'))).toBe(false);
    expect(ROUTE_REGISTRY.some((route) => route.path === '/permissions')).toBe(false);
  });

  it('keeps legacy paths unique and separate from canonical paths', () => {
    const legacyPaths = ROUTE_REGISTRY.flatMap((route) => route.legacyPaths);
    const canonicalPaths = new Set(ROUTE_REGISTRY.map((route) => route.path));
    expect(new Set(legacyPaths).size).toBe(legacyPaths.length);
    expect(legacyPaths.every((legacyPath) => !canonicalPaths.has(legacyPath))).toBe(true);
    expect(legacyPaths.every((legacyPath) => !ROUTE_REGISTRY.some((route) => route.path === legacyPath))).toBe(true);
  });

  it('keeps Search out of primary surfaces and retains its deep-link page', () => {
    const search = ROUTE_REGISTRY.find((route) => route.id === 'system.search');
    expect(search?.kind).toBe('search');
    expect(search?.surfaces).toEqual(['palette', 'search', 'shortcuts']);
    expect(search?.surfaces).not.toContain('sidebar');
    expect(search?.surfaces).not.toContain('mobile-primary');
    expect(search?.surfaces).not.toContain('mobile-more');
  });
});

describe('route permissions', () => {
  it('treats an empty requirement as authenticated-public access', () => {
    expect(isRoutePermitted(routeWith({}), new Set())).toBe(true);
  });

  it('requires every all key', () => {
    const route = routeWith({ all: ['ranking:list', 'ranking:read'] });
    expect(isRoutePermitted(route, new Set(['ranking:list']))).toBe(false);
    expect(isRoutePermitted(route, new Set(['ranking:list', 'ranking:read']))).toBe(true);
  });

  it('accepts any one any-of key', () => {
    const route = routeWith({ any: ['maintenance:update', 'backup:create'] });
    expect(isRoutePermitted(route, new Set(['backup:create']))).toBe(true);
    expect(isRoutePermitted(route, new Set(['settings:update']))).toBe(false);
  });

  it('honors the audited all:all bypass', () => {
    expect(isRoutePermitted(routeWith({ all: ['audit:list'] }), new Set(['all:all']))).toBe(true);
  });

  it.each([
    ['contests.tabs.overview', ['contest:read']],
    ['contests.tabs.tasks', ['contest:read', 'task:read']],
    ['contests.tabs.participants', ['contest:read', 'participation:read', 'user:read']],
    ['contests.tabs.communications', ['contest:read', 'announcement:read', 'question:read', 'ranking:read']],
    ['contests.tabs.settings', ['contest:read']],
    ['tasks.tabs.overview', ['task:read', 'statement:read']],
    ['tasks.tabs.datasets', ['task:read', 'dataset:read']],
    ['tasks.tabs.files', ['task:read', 'attachment:read']],
    ['tasks.tabs.settings', ['task:read']],
    ['people.user-tabs.profile', ['user:read']],
    ['people.user-tabs.teams', ['user:read', 'participation:list', 'team:read']],
    ['people.user-tabs.history', ['user:read', 'participation:list', 'submission:read']],
    ['people.team-tabs.overview', ['team:read']],
    ['people.team-tabs.members', ['team:read', 'participation:list', 'user:read']],
    ['people.team-tabs.contests', ['team:read', 'participation:list', 'contest:read']],
    ['evaluation.submission-tabs.summary', ['submission:read']],
    ['evaluation.submission-tabs.results', ['submission:read', 'submissionresult:read', 'file:read']],
    ['evaluation.submission-tabs.logs', ['submission:read', 'submissionresult:read']],
    ['evaluation.submission-tabs.evaluation', ['submission:read', 'evaluation:read']],
  ] as const)('%s requires its complete reader contract', (routeId, requiredKeys) => {
    const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
    if (!descriptor) throw new Error(`Missing test descriptor: ${routeId}`);
    const enabledDescriptor = { ...descriptor, enabled: true };

    expect(isRoutePermitted(enabledDescriptor, new Set(requiredKeys))).toBe(true);
    expect(tabIdsVisibleTo(new Set(requiredKeys))).toContain(routeId);
    for (const missingKey of requiredKeys) {
      const partialKeys = requiredKeys.filter((key) => key !== missingKey);
      expect(isRoutePermitted(enabledDescriptor, new Set(partialKeys))).toBe(false);
      expect(tabIdsVisibleTo(new Set(partialKeys))).not.toContain(routeId);
    }
  });

  it('applies the same partial-set rule to every all-of module route', () => {
    const moduleCases = [
      ['administration.admins', ['admin:list', 'admin:read']],
      ['administration.groups', ['group:list', 'group:read']],
      ['administration.audit', ['audit:list', 'audit:read']],
      ['infrastructure.deployments', ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read']],
      ['infrastructure.containers', ['container:list', 'container:read']],
      ['infrastructure.resources', ['resource:list', 'resource:read']],
      ['infrastructure.ranking', ['ranking:list', 'ranking:read']],
      ['system.appearance', ['appearance:read', 'appearance:list']],
      ['system.settings', ['env:read', 'env:list', 'monitor:read', 'monitor:list']],
      ['system.search', ['all:all']],
    ] as const;

    for (const [routeId, requiredKeys] of moduleCases) {
      const descriptor = ROUTE_REGISTRY.find((route) => route.id === routeId);
      if (!descriptor) throw new Error(`Missing test descriptor: ${routeId}`);
      const enabledDescriptor = { ...descriptor, enabled: true };
      expect(isRoutePermitted(enabledDescriptor, new Set(requiredKeys))).toBe(true);
      for (const missingKey of requiredKeys) {
        const partialKeys = requiredKeys.filter((key) => key !== missingKey);
        expect(isRoutePermitted(enabledDescriptor, new Set(partialKeys))).toBe(false);
      }
    }
  });

  it('keeps update permissions out of the read route', () => {
    const contestSettings = ROUTE_REGISTRY.find((route) => route.id === 'contests.tabs.settings');
    const taskSettings = ROUTE_REGISTRY.find((route) => route.id === 'tasks.tabs.settings');
    if (!contestSettings || !taskSettings) throw new Error('Missing settings descriptors');
    expect(isRoutePermitted({ ...contestSettings, enabled: true }, new Set(['contest:read']))).toBe(true);
    expect(isRoutePermitted({ ...taskSettings, enabled: true }, new Set(['task:read']))).toBe(true);
    expect(contestSettings.permission.all).not.toContain('contest:update');
    expect(taskSettings.permission.all).not.toContain('task:update');
  });

  it('uses any-of only for the verified Maintenance alternative', () => {
    const maintenance = ROUTE_REGISTRY.find((route) => route.id === 'system.maintenance');
    if (!maintenance) throw new Error('Missing maintenance descriptor');
    expect(maintenance.permission).toEqual({ any: ['maintenance:update', 'backup:create'] });
    expect(isRoutePermitted({ ...maintenance, enabled: true }, new Set(['maintenance:update']))).toBe(true);
    expect(isRoutePermitted({ ...maintenance, enabled: true }, new Set(['backup:create']))).toBe(true);
    expect(isRoutePermitted({ ...maintenance, enabled: true }, new Set(['settings:update']))).toBe(false);
  });

  it('uses only permission keys already registered in the permission registry', () => {
    const registered = new Set(PERMISSION_REGISTRY.map((definition) => definition.key));
    for (const route of ROUTE_REGISTRY) {
      const requiredKeys = [...(route.permission.all ?? []), ...(route.permission.any ?? [])];
      for (const key of requiredKeys) expect(registered.has(key)).toBe(true);
    }
  });
});

describe('locale-preserving route builders', () => {
  it('builds module, record landing, and nested tab routes', () => {
    expect(buildRoute('th', 'home')).toBe('/th');
    expect(buildRoute('th', 'people.users')).toBe('/th/people/users');
    expect(buildRoute('th', 'contests.record', { id: 42 })).toBe('/th/contests/42');
    expect(buildRoute('th', 'contests.tabs.overview', { id: 42 })).toBe(
      '/th/contests/42/overview',
    );
  });

  it('encodes dynamic values and rejects missing placeholders', () => {
    expect(buildRoute('en', 'people.user-record', { id: 'a/b' })).toBe(
      '/en/people/users/a%2Fb',
    );
    expect(() => buildRoute('en', 'people.user-record')).toThrow(
      'Missing route parameter: id',
    );
  });

  it('builds every declared target without leaving a placeholder', () => {
    for (const route of ROUTE_REGISTRY) {
      const href = buildRoute('th', route.id, { id: 42 });
      expect(href.startsWith('/th')).toBe(true);
      expect(href).not.toContain('[id]');
    }
  });
});

describe('legacy redirects', () => {
  it('redirects every descriptor-owned legacy path to its canonical target', () => {
    const cases = [
      ['/users', ['user:list'], '/th/people/users'],
      ['/teams', ['team:list'], '/th/people/teams'],
      ['/submissions', ['submission:list'], '/th/evaluation/submissions'],
      ['/submissions/lanes', ['evaluation:list'], '/th/evaluation/lanes'],
      ['/admins', ['admin:list', 'admin:read'], '/th/administration/admins'],
      ['/groups', ['group:list', 'group:read'], '/th/administration/groups'],
      ['/audit', ['audit:list', 'audit:read'], '/th/administration/audit'],
      ['/deployments', ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'], '/th/infrastructure/deployments'],
      ['/containers', ['container:list', 'container:read'], '/th/infrastructure/containers'],
      ['/resources', ['resource:list', 'resource:read'], '/th/infrastructure/resources'],
      ['/ranking', ['ranking:list', 'ranking:read'], '/th/infrastructure/ranking'],
      ['/appearance', ['appearance:read', 'appearance:list'], '/th/system/appearance'],
      ['/maintenance', ['maintenance:update'], '/th/system/maintenance'],
      ['/settings', ['env:read', 'env:list', 'monitor:read', 'monitor:list'], '/th/system/settings'],
      ['/docs', [], '/th/system/docs'],
    ] as const;

    for (const [legacyPath, permissions, expected] of cases) {
      expect(resolveLegacyRedirect('th', legacyPath, new Set(permissions))).toBe(expected);
    }
  });

  it('selects Admins, then Groups, then Audit for /permissions', () => {
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['audit:list', 'audit:read']))).toBe(
      '/th/administration/audit',
    );
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['group:list', 'group:read']))).toBe(
      '/th/administration/groups',
    );
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['admin:list', 'admin:read']))).toBe(
      '/th/administration/admins',
    );
  });

  it('falls back when an explicit permissions tab target is denied', () => {
    expect(resolveLegacyRedirect('th', '/permissions?tab=admins', new Set(['group:list', 'group:read']))).toBe(
      '/th/administration/groups',
    );
    expect(resolveLegacyRedirect('th', '/permissions?tab=groups', new Set(['audit:list', 'audit:read']))).toBe(
      '/th/administration/audit',
    );
  });

  it('returns null instead of exposing an unauthorized target', () => {
    expect(resolveLegacyRedirect('th', '/permissions', new Set(['settings:update']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/users', new Set(['task:list']))).toBeNull();
    expect(resolveLegacyRedirect('th', '/unknown', new Set(['all:all']))).toBeNull();
  });

  it('retains /search as a canonical deep link rather than a redirect', () => {
    expect(resolveLegacyRedirect('th', '/search', new Set())).toBeNull();
    expect(buildRoute('th', 'system.search')).toBe('/th/search');
  });
});

describe('navigation groups', () => {
  it('contains only declared top-level route IDs', () => {
    const routeIds = new Set(ROUTE_REGISTRY.map((route) => route.id));
    for (const group of NAVIGATION_GROUPS) {
      expect(group.routeIds.length).toBeGreaterThan(0);
      for (const routeId of group.routeIds) expect(routeIds.has(routeId)).toBe(true);
    }
  });
});
