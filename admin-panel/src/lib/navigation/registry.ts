import { isRoutePermitted } from '@/lib/navigation/permissions';
import type {
  NavigationGroupDescriptor,
  NavigationSurface,
  PermissionRequirement,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

const DIRECT_PAGE_SURFACES: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-primary',
  'mobile-more',
  'palette',
  'search',
  'shortcuts',
  'breadcrumbs',
];

const GROUP_PAGE_SURFACES: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-more',
  'palette',
  'search',
  'shortcuts',
  'breadcrumbs',
];

const RECORD_SURFACES: readonly NavigationSurface[] = [
  'palette',
  'search',
  'breadcrumbs',
];

const TAB_SURFACES: readonly NavigationSurface[] = ['tabs', 'breadcrumbs'];

function labelKeyFor(routeId: RouteId): string {
  return `navigation.${routeId}.label`;
}

function pageRoute(
  id: RouteId,
  path: string,
  permission: PermissionRequirement,
  legacyPaths: readonly string[],
  surfaces: readonly NavigationSurface[] = GROUP_PAGE_SURFACES,
): RouteDescriptor {
  return {
    id,
    path,
    kind: 'page',
    permission,
    labelKey: labelKeyFor(id),
    legacyPaths,
    tabIds: [],
    surfaces,
    enabled: false,
  };
}

function directPageRoute(
  id: RouteId,
  path: string,
  permission: PermissionRequirement,
  legacyPaths: readonly string[],
  surfaces: readonly NavigationSurface[] = DIRECT_PAGE_SURFACES,
): RouteDescriptor {
  return { ...pageRoute(id, path, permission, legacyPaths, surfaces), enabled: true };
}

function recordRoute(
  id: RouteId,
  path: string,
  parentId: RouteId,
  permission: PermissionRequirement,
  tabIds: readonly RouteId[],
  defaultChildId: RouteId,
): RouteDescriptor {
  return {
    id,
    path,
    kind: 'record-landing',
    parentId,
    permission,
    labelKey: labelKeyFor(id),
    legacyPaths: [],
    defaultChildId,
    tabIds,
    surfaces: RECORD_SURFACES,
    enabled: false,
  };
}

function tabRoute(
  id: RouteId,
  path: string,
  parentId: RouteId,
  permission: PermissionRequirement,
): RouteDescriptor {
  return {
    id,
    path,
    kind: 'nested-tab',
    parentId,
    permission,
    labelKey: labelKeyFor(id),
    legacyPaths: [],
    tabIds: [],
    surfaces: TAB_SURFACES,
    enabled: false,
  };
}

function searchRoute(
  id: RouteId,
  path: string,
  permission: PermissionRequirement,
  legacyPaths: readonly string[],
  surfaces: readonly NavigationSurface[],
): RouteDescriptor {
  return {
    id,
    path,
    kind: 'search',
    permission,
    labelKey: labelKeyFor(id),
    legacyPaths,
    tabIds: [],
    surfaces,
    enabled: false,
  };
}

export const ROUTE_REGISTRY: readonly RouteDescriptor[] = [
  directPageRoute('home', '/', {}, [], DIRECT_PAGE_SURFACES),
  directPageRoute('contests.list', '/contests', { all: ['contest:list'] }, []),
  // Why: Task 2 ships the physical Contest detail routes, so the record
  // landing and its five tabs are the only migration descriptors enabled —
  // every other migration descriptor stays disabled until its own task.
  { ...recordRoute(
    'contests.record',
    '/contests/[id]',
    'contests.list',
    { all: ['contest:read'] },
    ['contests.tabs.overview', 'contests.tabs.tasks', 'contests.tabs.participants', 'contests.tabs.communications', 'contests.tabs.settings'],
    'contests.tabs.overview',
  ), enabled: true },
  { ...tabRoute('contests.tabs.overview', '/contests/[id]/overview', 'contests.record', { all: ['contest:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.tasks', '/contests/[id]/tasks', 'contests.record', { all: ['contest:read', 'task:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.participants', '/contests/[id]/participants', 'contests.record', { all: ['contest:read', 'participation:read', 'user:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.communications', '/contests/[id]/communications', 'contests.record', { all: ['contest:read', 'announcement:read', 'question:read', 'ranking:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.settings', '/contests/[id]/settings', 'contests.record', { all: ['contest:read'] }), enabled: true },

  directPageRoute('tasks.list', '/tasks', { all: ['task:list'] }, []),
  // Why: Task 4 proved the physical Task routes, so the record and its four
  // tabs join the enabled set — all other migration descriptors stay disabled.
  { ...recordRoute('tasks.record', '/tasks/[id]', 'tasks.list', { all: ['task:read'] }, ['tasks.tabs.overview', 'tasks.tabs.datasets', 'tasks.tabs.files', 'tasks.tabs.settings'], 'tasks.tabs.overview'), enabled: true },
  { ...tabRoute('tasks.tabs.overview', '/tasks/[id]/overview', 'tasks.record', { all: ['task:read', 'statement:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.datasets', '/tasks/[id]/datasets', 'tasks.record', { all: ['task:read', 'dataset:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.files', '/tasks/[id]/files', 'tasks.record', { all: ['task:read', 'attachment:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.settings', '/tasks/[id]/settings', 'tasks.record', { all: ['task:read'] }), enabled: true },

  // Why: Task 2 ships the physical User routes, so the users page, the record
  // landing and its three tabs join the enabled set — the Team descriptors
  // stay disabled until Task 3 proves their routes.
  { ...pageRoute('people.users', '/people/users', { all: ['user:list'] }, ['/users']), enabled: true },
  { ...recordRoute(
    'people.user-record',
    '/people/users/[id]',
    'people.users',
    { all: ['user:read'] },
    ['people.user-tabs.profile', 'people.user-tabs.teams', 'people.user-tabs.history'],
    'people.user-tabs.profile',
  ), enabled: true },
  { ...tabRoute('people.user-tabs.profile', '/people/users/[id]/profile', 'people.user-record', { all: ['user:read'] }), enabled: true },
  { ...tabRoute('people.user-tabs.teams', '/people/users/[id]/teams', 'people.user-record', { all: ['user:read', 'participation:list', 'team:read'] }), enabled: true },
  { ...tabRoute('people.user-tabs.history', '/people/users/[id]/history', 'people.user-record', { all: ['user:read', 'participation:list', 'submission:read'] }), enabled: true },
  pageRoute('people.teams', '/people/teams', { all: ['team:list'] }, ['/teams']),
  recordRoute(
    'people.team-record',
    '/people/teams/[id]',
    'people.teams',
    { all: ['team:read'] },
    ['people.team-tabs.overview', 'people.team-tabs.members', 'people.team-tabs.contests'],
    'people.team-tabs.overview',
  ),
  tabRoute('people.team-tabs.overview', '/people/teams/[id]/overview', 'people.team-record', { all: ['team:read'] }),
  tabRoute('people.team-tabs.members', '/people/teams/[id]/members', 'people.team-record', { all: ['team:read', 'participation:list', 'user:read'] }),
  tabRoute('people.team-tabs.contests', '/people/teams/[id]/contests', 'people.team-record', { all: ['team:read', 'participation:list', 'contest:read'] }),

  pageRoute('evaluation.submissions', '/evaluation/submissions', { all: ['submission:list'] }, ['/submissions']),
  recordRoute(
    'evaluation.submission-record',
    '/evaluation/submissions/[id]',
    'evaluation.submissions',
    { all: ['submission:read'] },
    ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation'],
    'evaluation.submission-tabs.summary',
  ),
  tabRoute('evaluation.submission-tabs.summary', '/evaluation/submissions/[id]/summary', 'evaluation.submission-record', { all: ['submission:read'] }),
  tabRoute('evaluation.submission-tabs.results', '/evaluation/submissions/[id]/results', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read', 'file:read'] }),
  tabRoute('evaluation.submission-tabs.logs', '/evaluation/submissions/[id]/logs', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read'] }),
  tabRoute('evaluation.submission-tabs.evaluation', '/evaluation/submissions/[id]/evaluation', 'evaluation.submission-record', { all: ['submission:read', 'evaluation:read'] }),
  pageRoute('evaluation.lanes', '/evaluation/lanes', { all: ['evaluation:list'] }, ['/submissions/lanes']),

  pageRoute('administration.admins', '/administration/admins', { all: ['admin:list', 'admin:read'] }, ['/admins']),
  pageRoute('administration.groups', '/administration/groups', { all: ['group:list', 'group:read'] }, ['/groups']),
  pageRoute('administration.audit', '/administration/audit', { all: ['audit:list', 'audit:read'] }, ['/audit']),

  pageRoute('infrastructure.deployments', '/infrastructure/deployments', { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] }, ['/deployments']),
  pageRoute('infrastructure.containers', '/infrastructure/containers', { all: ['container:list', 'container:read'] }, ['/containers']),
  pageRoute('infrastructure.resources', '/infrastructure/resources', { all: ['resource:list', 'resource:read'] }, ['/resources']),
  pageRoute('infrastructure.ranking', '/infrastructure/ranking', { all: ['ranking:list', 'ranking:read'] }, ['/ranking']),

  pageRoute('system.appearance', '/system/appearance', { all: ['appearance:read', 'appearance:list'] }, ['/appearance']),
  pageRoute('system.maintenance', '/system/maintenance', { any: ['maintenance:update', 'backup:create'] }, ['/maintenance']),
  pageRoute('system.settings', '/system/settings', { all: ['env:read', 'env:list', 'monitor:read', 'monitor:list'] }, ['/settings']),
  pageRoute('system.docs', '/system/docs', {}, ['/docs']),
  searchRoute('system.search', '/search', { all: ['all:all'] }, [], ['palette', 'search', 'shortcuts']),
];

export const ADMINISTRATION_ROUTE_IDS = [
  'administration.admins',
  'administration.groups',
  'administration.audit',
] as const satisfies readonly RouteId[];

export const NAVIGATION_GROUPS: readonly NavigationGroupDescriptor[] = [
  { id: 'direct', labelKey: 'navigation.groups.direct', routeIds: ['home', 'contests.list', 'tasks.list'] },
  { id: 'people', labelKey: 'navigation.groups.people', routeIds: ['people.users', 'people.teams'] },
  { id: 'evaluation', labelKey: 'navigation.groups.evaluation', routeIds: ['evaluation.submissions', 'evaluation.lanes'] },
  { id: 'administration', labelKey: 'navigation.groups.administration', routeIds: [...ADMINISTRATION_ROUTE_IDS] },
  { id: 'infrastructure', labelKey: 'navigation.groups.infrastructure', routeIds: ['infrastructure.deployments', 'infrastructure.containers', 'infrastructure.resources', 'infrastructure.ranking'] },
  { id: 'system', labelKey: 'navigation.groups.system', routeIds: ['system.appearance', 'system.maintenance', 'system.settings', 'system.docs'] },
];

export function visibleRoutes(
  effective: ReadonlySet<string>,
  surface: NavigationSurface,
): readonly RouteDescriptor[] {
  return ROUTE_REGISTRY.filter(
    (route) =>
      route.enabled &&
      route.surfaces.includes(surface) &&
      isRoutePermitted(route, effective),
  );
}
