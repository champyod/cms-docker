import type {
  NavigationSurface,
  PermissionRequirement,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

// Why: the descriptor factories live in their own module so each registry
// slice module can declare routes without re-importing the assembled
// ROUTE_REGISTRY, which would close an import cycle.
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

export function pageRoute(
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

export function directPageRoute(
  id: RouteId,
  path: string,
  permission: PermissionRequirement,
  legacyPaths: readonly string[],
  surfaces: readonly NavigationSurface[] = DIRECT_PAGE_SURFACES,
): RouteDescriptor {
  return { ...pageRoute(id, path, permission, legacyPaths, surfaces), enabled: true };
}

export function recordRoute(
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

export function tabRoute(
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

export function searchRoute(
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
