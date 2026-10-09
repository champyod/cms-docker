import { BACKUP_MODE_PERMISSION_KEYS } from '@/lib/backup/modes';
import {
  enabledPageRoute,
  GROUP_PAGE_SURFACES_WITHOUT_CHORD,
  pageRoute,
  searchRoute,
} from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor } from '@/lib/navigation/types';

// Search is deep-link-only: it declares no sidebar or mobile surface.
export const PLATFORM_ROUTES: readonly RouteDescriptor[] = [
  enabledPageRoute('administration.admins', '/administration/admins', { all: ['admin:list', 'admin:read'] }, ['/admins']),
  enabledPageRoute('administration.groups', '/administration/groups', { all: ['group:list', 'group:read'] }, ['/groups']),
  enabledPageRoute('administration.audit', '/administration/audit', { all: ['audit:list', 'audit:read'] }, ['/audit']),

  enabledPageRoute('infrastructure.deployments', '/infrastructure/deployments', { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] }, ['/deployments']),
  enabledPageRoute('infrastructure.containers', '/infrastructure/containers', { all: ['container:list', 'container:read'] }, ['/containers']),
  enabledPageRoute('infrastructure.resources', '/infrastructure/resources', { all: ['resource:list', 'resource:read'] }, ['/resources']),
  enabledPageRoute('infrastructure.ranking', '/infrastructure/ranking', { all: ['ranking:list', 'ranking:read'] }, ['/ranking']),

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
