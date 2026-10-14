import { BACKUP_MODE_PERMISSION_KEYS } from '@/lib/backup/modes';
import {
  enabledPageRoute,
  GROUP_PAGE_SURFACES_WITHOUT_CHORD,
  pageRoute,
  searchRoute,
} from '@/lib/navigation/registry-descriptors';
import type { NavigationSurface, RouteDescriptor } from '@/lib/navigation/types';

// Why the alert centre is a Direct route rather than a module field: it is the bell's full-page
// surface, mounted at the shell root like Home, and it reuses the gate the stream already checks.
// Why it stays off mobile-primary: that bar is a fixed four, and the bell's popup carries the
// view-all link on phones.
const ALERT_CENTRE_SURFACES: readonly NavigationSurface[] = ['sidebar', 'mobile-more', 'palette', 'search'];

// Search is deep-link-only: it declares no sidebar or mobile surface.
export const PLATFORM_ROUTES: readonly RouteDescriptor[] = [
  enabledPageRoute('administration.admins', '/administration/admins', { all: ['admin:list', 'admin:read'] }, ['/admins']),
  enabledPageRoute('administration.groups', '/administration/groups', { all: ['group:list', 'group:read'] }, ['/groups']),
  enabledPageRoute('administration.audit', '/administration/audit', { all: ['audit:list', 'audit:read'] }, ['/audit']),
  enabledPageRoute('notifications', '/notifications', { all: ['audit:read'] }, [], ALERT_CENTRE_SURFACES),

  enabledPageRoute('infrastructure.deployments', '/infrastructure/deployments', { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] }, ['/deployments']),
  enabledPageRoute('infrastructure.containers', '/infrastructure/containers', { all: ['container:list', 'container:read'] }, ['/containers']),
  enabledPageRoute('infrastructure.resources', '/infrastructure/resources', { all: ['resource:list', 'resource:read'] }, ['/resources']),
  // WHY container:control and not a read key: a service row carries internal hostnames and ports, so the screen that reveals the deployment's shape is gated like the container controls beside it.
  enabledPageRoute('infrastructure.services', '/infrastructure/services', { all: ['container:control'] }, []),
  enabledPageRoute('ranking.board', '/ranking', { all: ['ranking:list', 'ranking:read'] }, ['/infrastructure/ranking']),
  enabledPageRoute('ranking.users', '/ranking/users', { all: ['ranking:list', 'ranking:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute('ranking.settings', '/ranking/settings', { all: ['ranking:list', 'ranking:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute('ranking.appearance', '/ranking/appearance', { all: ['ranking:list', 'ranking:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute('ranking.lockouts', '/ranking/lockouts', { all: ['ranking:list', 'ranking:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute('ranking.credits', '/ranking/credits', { all: ['ranking:list', 'ranking:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),

  enabledPageRoute('system.appearance', '/system/appearance', { all: ['appearance:read', 'appearance:list'] }, ['/appearance']),
  enabledPageRoute('system.maintenance', '/system/maintenance', { any: ['maintenance:update', 'backup:create'] }, ['/maintenance']),
  enabledPageRoute(
    'system.backup-restore',
    '/system/backup-restore',
    { any: BACKUP_MODE_PERMISSION_KEYS },
    [],
  ),
  enabledPageRoute('system.settings', '/system/settings', { all: ['env:read', 'env:list', 'monitor:read', 'monitor:list'] }, ['/settings']),
  enabledPageRoute('system.docs', '/system/docs', {}, ['/docs']),
  enabledPageRoute('system.about', '/system/about', {}, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  { ...searchRoute('system.search', '/search', { all: ['all:all'] }, [], ['palette', 'search', 'shortcuts']), enabled: true },

  // Why disabled and surface-less: sign-out is a route handler, not a page, so it has
  // nothing to render and belongs on no navigation surface — declaring it here is what
  // keeps the sign-out URL owned by the one registry instead of a literal in the palette
  // that no other route can be checked against. Why no requirement: the handler clears the
  // session and redirects, so requiring a key would strand a reader who cannot hold one.
  pageRoute('auth.signout', '/auth/signout', {}, [], []),
];
