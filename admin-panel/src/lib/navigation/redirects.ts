import { ADMINISTRATION_ROUTE_IDS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { buildRoute } from '@/lib/navigation/routes';
import type { LegacyRedirectRule, RouteId } from '@/lib/navigation/types';

export const LEGACY_REDIRECT_RULES: readonly LegacyRedirectRule[] = [
  { path: '/permissions?tab=admins', preferredRouteId: 'administration.admins' },
  { path: '/permissions?tab=groups', preferredRouteId: 'administration.groups' },
  { path: '/permissions', preferredRouteId: 'administration.admins' },
];

const ROUTE_BY_ID = new Map(ROUTE_REGISTRY.map((route) => [route.id, route]));

function findAdministrationFallback(
  effective: ReadonlySet<string>,
): RouteId | null {
  for (const routeId of ADMINISTRATION_ROUTE_IDS) {
    const route = ROUTE_BY_ID.get(routeId);
    if (route && isRoutePermitted(route, effective)) return routeId;
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
  if (ADMINISTRATION_ROUTE_IDS.some((candidate) => candidate === routeId)) {
    const fallback = findAdministrationFallback(effective);
    return fallback ? buildRoute(locale, fallback) : null;
  }
  return null;
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
