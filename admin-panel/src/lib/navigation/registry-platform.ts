import { enabledPageRoute, pageRoute, searchRoute } from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor } from '@/lib/navigation/types';

// Why: the platform slice groups the administration, infrastructure, and system
// modules; only the Administration and Infrastructure descriptors have a proven
// physical route, so system stays disabled until its own slice lands.
export const PLATFORM_ROUTES: readonly RouteDescriptor[] = [
  enabledPageRoute('administration.admins', '/administration/admins', { all: ['admin:list', 'admin:read'] }, ['/admins']),
  enabledPageRoute('administration.groups', '/administration/groups', { all: ['group:list', 'group:read'] }, ['/groups']),
  enabledPageRoute('administration.audit', '/administration/audit', { all: ['audit:list', 'audit:read'] }, ['/audit']),

  enabledPageRoute('infrastructure.deployments', '/infrastructure/deployments', { all: ['deployment:list', 'deployment:read', 'env:read', 'env:list', 'contest:list', 'container:read', 'settings:read', 'settings:list', 'task:read'] }, ['/deployments']),
  enabledPageRoute('infrastructure.containers', '/infrastructure/containers', { all: ['container:list', 'container:read'] }, ['/containers']),
  enabledPageRoute('infrastructure.resources', '/infrastructure/resources', { all: ['resource:list', 'resource:read'] }, ['/resources']),
  enabledPageRoute('infrastructure.ranking', '/infrastructure/ranking', { all: ['ranking:list', 'ranking:read'] }, ['/ranking']),

  pageRoute('system.appearance', '/system/appearance', { all: ['appearance:read', 'appearance:list'] }, ['/appearance']),
  pageRoute('system.maintenance', '/system/maintenance', { any: ['maintenance:update', 'backup:create'] }, ['/maintenance']),
  pageRoute('system.settings', '/system/settings', { all: ['env:read', 'env:list', 'monitor:read', 'monitor:list'] }, ['/settings']),
  pageRoute('system.docs', '/system/docs', {}, ['/docs']),
  searchRoute('system.search', '/search', { all: ['all:all'] }, [], ['palette', 'search', 'shortcuts']),
];
