import { enabledPageRoute, pageRoute, searchRoute } from '@/lib/navigation/registry-descriptors';
import type { NavigationSurface, RouteDescriptor } from '@/lib/navigation/types';

/**
 * A module's non-landing page: reachable as a tab in the module shell, and from
 * the palette, the search page, and the shortcut chords, but absent from the
 * sidebar and the mobile bars, which show the module's landing page instead.
 */
const MODULE_TAB_SURFACES: readonly NavigationSurface[] = [
  'tabs',
  'palette',
  'search',
  'shortcuts',
  'breadcrumbs',
];

// Why: the platform slice groups the administration, infrastructure, and system
// modules, and every descriptor here is enabled because its physical route landed
// in the same commit. Search is the retained deep-link capability and is answered
// from the palette and the search page, so it declares no sidebar or mobile
// surface and reaches the reader only where they already opted in.
export const PLATFORM_ROUTES: readonly RouteDescriptor[] = [
  enabledPageRoute('administration.admins', '/administration/admins', { all: ['admin:list', 'admin:read'] }, ['/admins']),
  enabledPageRoute('administration.groups', '/administration/groups', { all: ['group:list', 'group:read'] }, ['/groups'], MODULE_TAB_SURFACES),
  enabledPageRoute('administration.audit', '/administration/audit', { all: ['audit:list', 'audit:read'] }, ['/audit'], MODULE_TAB_SURFACES),

  enabledPageRoute('infrastructure.deployments', '/infrastructure/deployments', { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] }, ['/deployments']),
  enabledPageRoute('infrastructure.containers', '/infrastructure/containers', { all: ['container:list', 'container:read'] }, ['/containers'], MODULE_TAB_SURFACES),
  enabledPageRoute('infrastructure.resources', '/infrastructure/resources', { all: ['resource:list', 'resource:read'] }, ['/resources'], MODULE_TAB_SURFACES),
  enabledPageRoute('infrastructure.ranking', '/infrastructure/ranking', { all: ['ranking:list', 'ranking:read'] }, ['/ranking'], MODULE_TAB_SURFACES),

  enabledPageRoute('system.appearance', '/system/appearance', { all: ['appearance:read', 'appearance:list'] }, ['/appearance']),
  enabledPageRoute('system.maintenance', '/system/maintenance', { any: ['maintenance:update', 'backup:create'] }, ['/maintenance'], MODULE_TAB_SURFACES),
  enabledPageRoute('system.settings', '/system/settings', { all: ['env:read', 'env:list', 'monitor:read', 'monitor:list'] }, ['/settings'], MODULE_TAB_SURFACES),
  enabledPageRoute('system.docs', '/system/docs', {}, ['/docs'], MODULE_TAB_SURFACES),
  { ...searchRoute('system.search', '/search', { all: ['all:all'] }, [], ['palette', 'search', 'shortcuts']), enabled: true },

  // Why disabled and surface-less: sign-out is a route handler, not a page, so it has
  // nothing to render and belongs on no navigation surface — declaring it here is what
  // keeps the sign-out URL owned by the one registry instead of a literal in the palette
  // that no other route can be checked against. Why no requirement: the handler clears the
  // session and redirects, so requiring a key would strand a reader who cannot hold one.
  pageRoute('auth.signout', '/auth/signout', {}, [], []),
];
