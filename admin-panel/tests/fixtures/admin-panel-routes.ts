import type {
  NavigationGroupDescriptor,
  PermissionRequirement,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

type RouteFixture = Pick<
  RouteDescriptor,
  'id' | 'path' | 'kind' | 'tabIds' | 'legacyPaths' | 'enabled'
> & {
  readonly parentId?: RouteId;
  readonly defaultChildId?: RouteId;
};

export const EXPECTED_ROUTE_MANIFEST: readonly RouteFixture[] = [
  { id: 'home', path: '/', kind: 'page', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.list', path: '/contests', kind: 'page', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.record', path: '/contests/[id]', kind: 'record-landing', parentId: 'contests.list', defaultChildId: 'contests.tabs.overview', tabIds: ['contests.tabs.overview', 'contests.tabs.tasks', 'contests.tabs.participants', 'contests.tabs.communications', 'contests.tabs.settings'], legacyPaths: [], enabled: true },
  { id: 'contests.tabs.overview', path: '/contests/[id]/overview', kind: 'nested-tab', parentId: 'contests.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.tabs.tasks', path: '/contests/[id]/tasks', kind: 'nested-tab', parentId: 'contests.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.tabs.participants', path: '/contests/[id]/participants', kind: 'nested-tab', parentId: 'contests.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.tabs.communications', path: '/contests/[id]/communications', kind: 'nested-tab', parentId: 'contests.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'contests.tabs.settings', path: '/contests/[id]/settings', kind: 'nested-tab', parentId: 'contests.record', tabIds: [], legacyPaths: [], enabled: true },

  { id: 'tasks.list', path: '/tasks', kind: 'page', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'tasks.record', path: '/tasks/[id]', kind: 'record-landing', parentId: 'tasks.list', defaultChildId: 'tasks.tabs.overview', tabIds: ['tasks.tabs.overview', 'tasks.tabs.datasets', 'tasks.tabs.files', 'tasks.tabs.settings'], legacyPaths: [], enabled: true },
  { id: 'tasks.tabs.overview', path: '/tasks/[id]/overview', kind: 'nested-tab', parentId: 'tasks.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'tasks.tabs.datasets', path: '/tasks/[id]/datasets', kind: 'nested-tab', parentId: 'tasks.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'tasks.tabs.files', path: '/tasks/[id]/files', kind: 'nested-tab', parentId: 'tasks.record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'tasks.tabs.settings', path: '/tasks/[id]/settings', kind: 'nested-tab', parentId: 'tasks.record', tabIds: [], legacyPaths: [], enabled: true },

  { id: 'people.users', path: '/people/users', kind: 'page', tabIds: [], legacyPaths: ['/users'], enabled: true },
  { id: 'people.user-record', path: '/people/users/[id]', kind: 'record-landing', parentId: 'people.users', defaultChildId: 'people.user-tabs.profile', tabIds: ['people.user-tabs.profile', 'people.user-tabs.teams', 'people.user-tabs.history'], legacyPaths: [], enabled: true },
  { id: 'people.user-tabs.profile', path: '/people/users/[id]/profile', kind: 'nested-tab', parentId: 'people.user-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'people.user-tabs.teams', path: '/people/users/[id]/teams', kind: 'nested-tab', parentId: 'people.user-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'people.user-tabs.history', path: '/people/users/[id]/history', kind: 'nested-tab', parentId: 'people.user-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'people.teams', path: '/people/teams', kind: 'page', tabIds: [], legacyPaths: ['/teams'], enabled: true },
  { id: 'people.team-record', path: '/people/teams/[id]', kind: 'record-landing', parentId: 'people.teams', defaultChildId: 'people.team-tabs.overview', tabIds: ['people.team-tabs.overview', 'people.team-tabs.members', 'people.team-tabs.contests'], legacyPaths: [], enabled: true },
  { id: 'people.team-tabs.overview', path: '/people/teams/[id]/overview', kind: 'nested-tab', parentId: 'people.team-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'people.team-tabs.members', path: '/people/teams/[id]/members', kind: 'nested-tab', parentId: 'people.team-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'people.team-tabs.contests', path: '/people/teams/[id]/contests', kind: 'nested-tab', parentId: 'people.team-record', tabIds: [], legacyPaths: [], enabled: true },

  { id: 'evaluation.submissions', path: '/evaluation/submissions', kind: 'page', tabIds: [], legacyPaths: ['/submissions'], enabled: true },
  { id: 'evaluation.submission-record', path: '/evaluation/submissions/[id]', kind: 'record-landing', parentId: 'evaluation.submissions', defaultChildId: 'evaluation.submission-tabs.summary', tabIds: ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation'], legacyPaths: [], enabled: true },
  { id: 'evaluation.submission-tabs.summary', path: '/evaluation/submissions/[id]/summary', kind: 'nested-tab', parentId: 'evaluation.submission-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'evaluation.submission-tabs.results', path: '/evaluation/submissions/[id]/results', kind: 'nested-tab', parentId: 'evaluation.submission-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'evaluation.submission-tabs.logs', path: '/evaluation/submissions/[id]/logs', kind: 'nested-tab', parentId: 'evaluation.submission-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'evaluation.submission-tabs.evaluation', path: '/evaluation/submissions/[id]/evaluation', kind: 'nested-tab', parentId: 'evaluation.submission-record', tabIds: [], legacyPaths: [], enabled: true },
  { id: 'evaluation.lanes', path: '/evaluation/lanes', kind: 'page', tabIds: [], legacyPaths: ['/submissions/lanes'], enabled: true },

  { id: 'administration.admins', path: '/administration/admins', kind: 'page', tabIds: [], legacyPaths: ['/admins'], enabled: true },
  { id: 'administration.groups', path: '/administration/groups', kind: 'page', tabIds: [], legacyPaths: ['/groups'], enabled: true },
  { id: 'administration.audit', path: '/administration/audit', kind: 'page', tabIds: [], legacyPaths: ['/audit'], enabled: true },

  { id: 'infrastructure.deployments', path: '/infrastructure/deployments', kind: 'page', tabIds: [], legacyPaths: ['/deployments'], enabled: true },
  { id: 'infrastructure.containers', path: '/infrastructure/containers', kind: 'page', tabIds: [], legacyPaths: ['/containers'], enabled: true },
  { id: 'infrastructure.resources', path: '/infrastructure/resources', kind: 'page', tabIds: [], legacyPaths: ['/resources'], enabled: true },
  { id: 'infrastructure.ranking', path: '/infrastructure/ranking', kind: 'page', tabIds: [], legacyPaths: ['/ranking'], enabled: true },

  { id: 'system.appearance', path: '/system/appearance', kind: 'page', tabIds: [], legacyPaths: ['/appearance'], enabled: true },
  { id: 'system.maintenance', path: '/system/maintenance', kind: 'page', tabIds: [], legacyPaths: ['/maintenance'], enabled: true },
  { id: 'system.settings', path: '/system/settings', kind: 'page', tabIds: [], legacyPaths: ['/settings'], enabled: true },
  { id: 'system.docs', path: '/system/docs', kind: 'page', tabIds: [], legacyPaths: ['/docs'], enabled: true },
  { id: 'system.search', path: '/search', kind: 'search', tabIds: [], legacyPaths: [], enabled: true },
];

export const EXPECTED_ROUTE_PERMISSIONS = {
  home: {},
  'contests.list': { all: ['contest:list'] },
  'contests.record': { all: ['contest:read'] },
  'contests.tabs.overview': { all: ['contest:read'] },
  'contests.tabs.tasks': { all: ['contest:read', 'task:read'] },
  'contests.tabs.participants': { all: ['contest:read', 'participation:read', 'user:read'] },
  'contests.tabs.communications': { all: ['contest:read', 'announcement:read', 'question:read', 'ranking:read'] },
  'contests.tabs.settings': { all: ['contest:read'] },
  'tasks.list': { all: ['task:list'] },
  'tasks.record': { all: ['task:read'] },
  'tasks.tabs.overview': { all: ['task:read', 'statement:read'] },
  'tasks.tabs.datasets': { all: ['task:read', 'dataset:read'] },
  'tasks.tabs.files': { all: ['task:read', 'attachment:read'] },
  'tasks.tabs.settings': { all: ['task:read'] },
  'people.users': { all: ['user:list'] },
  'people.user-record': { all: ['user:read'] },
  'people.user-tabs.profile': { all: ['user:read'] },
  'people.user-tabs.teams': { all: ['user:read', 'participation:list', 'team:read'] },
  'people.user-tabs.history': { all: ['user:read', 'participation:list', 'submission:read'] },
  'people.teams': { all: ['team:list'] },
  'people.team-record': { all: ['team:read'] },
  'people.team-tabs.overview': { all: ['team:read'] },
  'people.team-tabs.members': { all: ['team:read', 'participation:list', 'user:read'] },
  'people.team-tabs.contests': { all: ['team:read', 'participation:list', 'contest:read'] },
  'evaluation.submissions': { all: ['submission:list'] },
  'evaluation.submission-record': { all: ['submission:read'] },
  'evaluation.submission-tabs.summary': { all: ['submission:read'] },
  'evaluation.submission-tabs.results': { all: ['submission:read', 'submissionresult:read', 'file:read'] },
  'evaluation.submission-tabs.logs': { all: ['submission:read', 'submissionresult:read'] },
  'evaluation.submission-tabs.evaluation': { all: ['submission:read', 'evaluation:read'] },
  'evaluation.lanes': { all: ['evaluation:list'] },
  'administration.admins': { all: ['admin:list', 'admin:read'] },
  'administration.groups': { all: ['group:list', 'group:read'] },
  'administration.audit': { all: ['audit:list', 'audit:read'] },
  'infrastructure.deployments': { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] },
  'infrastructure.containers': { all: ['container:list', 'container:read'] },
  'infrastructure.resources': { all: ['resource:list', 'resource:read'] },
  'infrastructure.ranking': { all: ['ranking:list', 'ranking:read'] },
  'system.appearance': { all: ['appearance:read', 'appearance:list'] },
  'system.maintenance': { any: ['maintenance:update', 'backup:create'] },
  'system.settings': { all: ['env:read', 'env:list', 'monitor:read', 'monitor:list'] },
  'system.docs': {},
  'system.search': { all: ['all:all'] },
} as const satisfies Readonly<Record<RouteId, PermissionRequirement>>;

export const EXPECTED_NAVIGATION_GROUPS: readonly NavigationGroupDescriptor[] = [
  { id: 'direct', labelKey: 'navigation.groups.direct', routeIds: ['home', 'contests.list', 'tasks.list'] },
  { id: 'people', labelKey: 'navigation.groups.people', routeIds: ['people.users', 'people.teams'] },
  { id: 'evaluation', labelKey: 'navigation.groups.evaluation', routeIds: ['evaluation.submissions', 'evaluation.lanes'] },
  { id: 'administration', labelKey: 'navigation.groups.administration', routeIds: ['administration.admins', 'administration.groups', 'administration.audit'] },
  { id: 'infrastructure', labelKey: 'navigation.groups.infrastructure', routeIds: ['infrastructure.deployments', 'infrastructure.containers', 'infrastructure.resources', 'infrastructure.ranking'] },
  { id: 'system', labelKey: 'navigation.groups.system', routeIds: ['system.appearance', 'system.maintenance', 'system.settings', 'system.docs'] },
];
