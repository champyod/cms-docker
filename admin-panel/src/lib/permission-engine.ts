import { PERMISSION_REGISTRY } from './permission-registry';

export type OverrideEffect = 'allow' | 'deny';

export interface PermissionOverride {
  permissionKey: string;
  effect: OverrideEffect;
}

const ALL_PERMISSION = 'all:all';

export function resolveEffectivePermissions(
  groupPermissionKeys: readonly string[],
  overrides: readonly PermissionOverride[],
): ReadonlySet<string> {
  const granted = new Set<string>(groupPermissionKeys);
  const denied = new Set<string>();

  // Why: overrides are split so the outcome never depends on their order — group
  // grants are unioned first, allows are added, and denies are removed last so a
  // deny always wins, whether it collides with a group grant or an allow.
  for (const override of overrides) {
    if (override.effect === 'deny') denied.add(override.permissionKey);
  }
  for (const override of overrides) {
    if (override.effect === 'allow') granted.add(override.permissionKey);
  }

  // Why: expand all:all into concrete registry keys before applying denies so a per-person deny always wins over the wildcard grant.
  if (granted.has(ALL_PERMISSION) && !denied.has(ALL_PERMISSION)) {
    for (const definition of PERMISSION_REGISTRY) granted.add(definition.key);
  } else {
    granted.delete(ALL_PERMISSION);
  }

  for (const key of denied) granted.delete(key);

  return granted;
}

export function hasEffectivePermission(effective: ReadonlySet<string>, permissionKey: string): boolean {
  if (effective.has(permissionKey)) return true;
  if (effective.has(ALL_PERMISSION) && effective.size === 1) return true;
  return false;
}

export function summarisePermissionChanges(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): { granted: string[]; revoked: string[] } {
  const granted: string[] = [];
  const revoked: string[] = [];

  for (const key of after) {
    if (!before.has(key)) granted.push(key);
  }
  for (const key of before) {
    if (!after.has(key)) revoked.push(key);
  }

  return { granted: granted.sort(), revoked: revoked.sort() };
}
