import { isRoutePermitted } from '@/lib/navigation/permissions';
import { COMPETITION_ROUTES } from '@/lib/navigation/registry-competition';
import { EVALUATION_ROUTES } from '@/lib/navigation/registry-evaluation';
import { PEOPLE_ROUTES } from '@/lib/navigation/registry-people';
import { PLATFORM_ROUTES } from '@/lib/navigation/registry-platform';
import type {
  NavigationGroupDescriptor,
  NavigationSurface,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

// Why: this module is the single assembled owner of the route manifest; each
// domain slice declares its own descriptors in a sibling module so the manifest
// stays readable and no consumer needs to know the slice layout.
export const ROUTE_REGISTRY: readonly RouteDescriptor[] = [
  ...COMPETITION_ROUTES,
  ...PEOPLE_ROUTES,
  ...EVALUATION_ROUTES,
  ...PLATFORM_ROUTES,
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
  { id: 'system', labelKey: 'navigation.groups.system', routeIds: ['system.appearance', 'system.maintenance', 'system.settings', 'system.docs', 'system.about'] },
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
