import { hasEffectivePermission } from '@/lib/permission-engine';
import type { PermissionKey } from '@/lib/permissions';
import type { RouteDescriptor } from '@/lib/navigation/types';

function permitsAll(
  effective: ReadonlySet<string>,
  keys: readonly PermissionKey[],
): boolean {
  return keys.every((key) => hasEffectivePermission(effective, key));
}

function permitsAny(
  effective: ReadonlySet<string>,
  keys: readonly PermissionKey[],
): boolean {
  return keys.some((key) => hasEffectivePermission(effective, key));
}

export function isRoutePermitted(
  route: RouteDescriptor,
  effective: ReadonlySet<string>,
): boolean {
  const all = route.permission.all ?? [];
  const any = route.permission.any ?? [];
  const passesAll = all.length === 0 || permitsAll(effective, all);
  const passesAny = any.length === 0 || permitsAny(effective, any);
  return passesAll && passesAny;
}
