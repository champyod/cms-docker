import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId, RouteParams } from '@/lib/navigation/types';

const ROUTE_BY_ID = new Map(ROUTE_REGISTRY.map((route) => [route.id, route]));

function replaceParameters(path: string, params: RouteParams): string {
  return path.replace(/\[([^\]]+)\]/g, (_match: string, key: string): string => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing route parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
}

export function buildRoute(
  locale: string,
  routeId: RouteId,
  params: RouteParams = {},
): string {
  const route = ROUTE_BY_ID.get(routeId);
  if (!route) throw new Error(`Unknown route: ${routeId}`);
  const path = replaceParameters(route.path, params);
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}
