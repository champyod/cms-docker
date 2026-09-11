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
  const effective = new Set<string>(groupPermissionKeys);

  // Why: overrides are split so the outcome never depends on their order — group
  // grants are unioned first, allows are added, and denies are removed last so a
  // deny always wins, whether it collides with a group grant or an allow.
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const override of overrides) {
    if (override.effect === 'deny') denied.push(override.permissionKey);
    else allowed.push(override.permissionKey);
  }

  for (const key of allowed) effective.add(key);
  for (const key of denied) effective.delete(key);

  return effective;
}

export function hasEffectivePermission(effective: ReadonlySet<string>, permissionKey: string): boolean {
  return effective.has(permissionKey) || effective.has(ALL_PERMISSION);
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
