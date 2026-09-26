import { notFound } from 'next/navigation';

import type { ModuleRouteNavItem } from '@/components/navigation/ModuleRouteNav';
import type { Dictionary } from '@/lib/dictionary';
import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { NavigationGroupDescriptor, RouteDescriptor } from '@/lib/navigation/types';
import { AuthorizationError } from '@/lib/server/authorization';

type ModuleGroupId = NavigationGroupDescriptor['id'];

/**
 * The one label resolver behind every module rail.
 *
 * Why shared: a module shell must not decide a label on its own, and a rail that
 * read the dictionary differently from its sibling would show the same route under
 * two names. The registry owns the key, so a missing label is a manifest defect
 * and fails the render rather than shipping an empty tab.
 */
export function labelForDescriptor(dict: Dictionary, descriptor: RouteDescriptor): string {
  const label = descriptor.labelKey.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, key);
  }, dict);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${descriptor.labelKey}`);
  }
  return label;
}

// Why: a route the reader may not open is omitted rather than rendered disabled,
// so the module rail never advertises a tab that answers 404.
export function permittedNavItems(
  groupId: ModuleGroupId,
  locale: string,
  dict: Dictionary,
  effective: ReadonlySet<string>,
): ModuleRouteNavItem[] {
  const group = NAVIGATION_GROUPS.find((item) => item.id === groupId);
  return (group?.routeIds ?? []).flatMap((id) => {
    const descriptor = ROUTE_REGISTRY.find((route) => route.id === id);
    if (!descriptor?.enabled || !isRoutePermitted(descriptor, effective)) return [];
    return [{
      id,
      label: labelForDescriptor(dict, descriptor),
      href: buildRoute(locale, id),
    }];
  });
}

// Why conceal: the shell loads permissions to build its own rail, so a caller
// whose permissions fail closed must not learn the module exists. A 401 and any
// unexpected storage failure keep propagating.
export async function concealedPermissions(): Promise<ReadonlySet<string>> {
  try {
    return await getRoutePermissions();
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
