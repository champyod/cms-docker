import { pageRoute, recordRoute, tabRoute } from '@/lib/navigation/registry-descriptors';
import type { NavigationSurface, RouteDescriptor } from '@/lib/navigation/types';

// Why: the users page is the People group's entry point, so it is the one group
// route the mobile bar shows directly instead of only through More. Surfaces only
// — the route itself is a group page in every other respect.
const PEOPLE_LANDING_SURFACES: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-primary',
  'mobile-more',
  'palette',
  'search',
  'shortcuts',
  'breadcrumbs',
];

// Why: a descriptor is enabled only where its physical route already exists,
// so the People set here is the users page, the teams page, both record
// landings, and their tabs. Every other slice keeps its own enablement.
export const PEOPLE_ROUTES: readonly RouteDescriptor[] = [
  { ...pageRoute('people.users', '/people/users', { all: ['user:list'] }, ['/users'], PEOPLE_LANDING_SURFACES), enabled: true },
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
  { ...pageRoute('people.teams', '/people/teams', { all: ['team:list'] }, ['/teams']), enabled: true },
  { ...recordRoute(
    'people.team-record',
    '/people/teams/[id]',
    'people.teams',
    { all: ['team:read'] },
    ['people.team-tabs.overview', 'people.team-tabs.members', 'people.team-tabs.contests'],
    'people.team-tabs.overview',
  ), enabled: true },
  { ...tabRoute('people.team-tabs.overview', '/people/teams/[id]/overview', 'people.team-record', { all: ['team:read'] }), enabled: true },
  { ...tabRoute('people.team-tabs.members', '/people/teams/[id]/members', 'people.team-record', { all: ['team:read', 'participation:list', 'user:read'] }), enabled: true },
  { ...tabRoute('people.team-tabs.contests', '/people/teams/[id]/contests', 'people.team-record', { all: ['team:read', 'participation:list', 'contest:read'] }), enabled: true },
];
