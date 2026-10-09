import { notFound } from 'next/navigation';

import type { Dictionary } from '@/lib/dictionary';
import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { NavigationGroupDescriptor, RouteDescriptor, RouteId } from '@/lib/navigation/types';
import { AuthorizationError } from '@/lib/server/authorization';

type ModuleGroupId = NavigationGroupDescriptor['id'];

/** One navigable field of a module: its registry id, dictionary label, and localized href. */
export interface ModuleFieldItem {
  readonly id: RouteId;
  readonly label: string;
  readonly href: string;
}

/** Resolves a descriptor's dictionary label, throwing when it is missing or blank. */
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

/**
 * The module's fields in group order, so a reader who may not open one is never
 * offered it rather than handed a 404.
 */
export function buildModuleFields(
  groupId: ModuleGroupId,
  locale: string,
  dict: Dictionary,
  effective: ReadonlySet<string>,
): ModuleFieldItem[] {
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

/** Effective keys for a module shell; a caller who fails closed is concealed as 404. */
export async function concealedPermissions(): Promise<ReadonlySet<string>> {
  try {
    return await getRoutePermissions();
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
