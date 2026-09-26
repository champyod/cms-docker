import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { buildRoute } from '@/lib/navigation/routes';
import type {
  LegacyRedirectRule,
  NavigationGroupDescriptor,
  RouteDescriptor,
  RouteId,
} from '@/lib/navigation/types';

export const LEGACY_REDIRECT_RULES: readonly LegacyRedirectRule[] = [
  { path: '/permissions?tab=admins', preferredRouteId: 'administration.admins' },
  { path: '/permissions?tab=groups', preferredRouteId: 'administration.groups' },
  { path: '/permissions', preferredRouteId: 'administration.admins' },
];

const ROUTE_BY_ID = new Map(ROUTE_REGISTRY.map((route) => [route.id, route]));

function declaresRequirement(route: RouteDescriptor): boolean {
  return (route.permission.all?.length ?? 0) > 0 || (route.permission.any?.length ?? 0) > 0;
}

// Why group order is the fallback order: the group descriptor is the single
// ordered list of its routes, so a denied legacy path lands on the first route in
// the same module the reader can open — Administration stays Admins → Groups →
// Audit, and Infrastructure and System gain the same deterministic fallback
// without a second path list to keep in sync.
//
// Why a fallback candidate must gate on something: isRoutePermitted admits a
// requirement-free route for every caller, so system.docs would otherwise become
// the universal fallback of the System group and answer a denied legacy path for
// a reader who holds no System key at all. Only a route that gates on a key the
// caller actually holds proves the caller may open that module, so a
// requirement-free route is never a fallback target. Direct resolution is
// deliberately unchanged: navigating /docs straight still lands there, which is
// exactly what declaring no requirement means.
function findGroupFallback(
  groupId: NavigationGroupDescriptor['id'],
  effective: ReadonlySet<string>,
): RouteId | null {
  const group = NAVIGATION_GROUPS.find((item) => item.id === groupId);
  for (const routeId of group?.routeIds ?? []) {
    const route = ROUTE_BY_ID.get(routeId);
    if (!route?.enabled || !declaresRequirement(route)) continue;
    if (isRoutePermitted(route, effective)) return routeId;
  }
  return null;
}

function resolveTarget(
  locale: string,
  routeId: RouteId,
  effective: ReadonlySet<string>,
): string | null {
  const route = ROUTE_BY_ID.get(routeId);
  if (!route) return null;
  if (isRoutePermitted(route, effective)) return buildRoute(locale, routeId);
  const group = NAVIGATION_GROUPS.find((item) => item.routeIds.includes(routeId));
  const fallback = group ? findGroupFallback(group.id, effective) : null;
  return fallback ? buildRoute(locale, fallback) : null;
}

export function resolveLegacyRedirect(
  locale: string,
  localeRelativePath: string,
  effective: ReadonlySet<string>,
): string | null {
  const descriptorRule = ROUTE_REGISTRY.find((route) =>
    route.legacyPaths.includes(localeRelativePath),
  );
  if (descriptorRule) {
    return resolveTarget(locale, descriptorRule.id, effective);
  }

  const permissionRule = LEGACY_REDIRECT_RULES.find(
    (rule) => rule.path === localeRelativePath,
  );
  return permissionRule
    ? resolveTarget(locale, permissionRule.preferredRouteId, effective)
    : null;
}
