import { PERMISSION_REGISTRY } from './permission-registry';

// Why: registry keys are always `${module}:${verb}`; this template literal rejects the legacy
// coarse names (all/tasks/users/contests/messaging) at compile time so stale call sites surface.
export type PermissionKey = `${string}:${string}`;

/**
 * The permission each named action demands, read by the action that enforces it and by the
 * button that offers it, so the two gates cannot drift apart.
 *
 * Why the map sits here rather than in `permissions.ts`: every action button is a client
 * component, and importing `permissions.ts` from one would pull Prisma into the browser bundle.
 * `permissions.ts` re-exports it, so server code reads the same value from either path.
 *
 * Why it is hand-maintained: a component has to be able to name the action it offers, and a value
 * derived from source cannot be named that way. `tests/action-permission-drift.test.ts` fails when
 * an entry and the gate its action actually demands disagree.
 */
export const ACTION_PERMISSIONS = {
  addParticipant: 'participation:create',
  createAdmin: 'admin:create',
  createAnnouncement: 'announcement:create',
  createContest: 'contest:create',
  createGroup: 'group:create',
  createTask: 'task:create',
  createTeam: 'team:create',
  deleteAdmin: 'admin:delete',
  deleteAnnouncement: 'announcement:delete',
  deleteContest: 'contest:delete',
  deleteGroup: 'group:delete',
  deleteTask: 'task:delete',
  deleteTeam: 'team:delete',
  deleteUser: 'user:delete',
  deployContest: 'deployment:deploy',
  ignoreQuestion: 'question:ignore',
  removeParticipant: 'participation:delete',
  replyToQuestion: 'question:answer',
  setAdminPassword: 'admin:password:update',
  setTestUser: 'participation:update',
  unignoreQuestion: 'question:ignore',
  updateAdmin: 'admin:update',
  updateContest: 'contest:update',
  updateGroup: 'group:update',
  updateParticipation: 'participation:update',
  updateTask: 'task:update',
  updateTeam: 'team:update',
  updateUser: 'user:update',
} as const satisfies Record<string, PermissionKey>;

export type ActionName = keyof typeof ACTION_PERMISSIONS;

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
  // Why backup:schedule skipped: scheduling a recurring backup is manual-grant
  // only and must never arrive via the wildcard, for a Superadmin or an override.
  if (granted.has(ALL_PERMISSION) && !denied.has(ALL_PERMISSION)) {
    for (const definition of PERMISSION_REGISTRY) {
      if (definition.key !== 'backup:schedule') granted.add(definition.key);
    }
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

export function isEffectiveSuperset(callerEffective: ReadonlySet<string>, targetEffective: ReadonlySet<string>): boolean {
  // Why: per-key via hasEffectivePermission so a raw all:all (size 1) expands to every registry key
  for (const key of targetEffective) if (!hasEffectivePermission(callerEffective, key)) return false;
  // Why: a raw all:all target holds every registry key implicitly — treat as full set so Superadmin is not seen as holding fewer
  if (targetEffective.has(ALL_PERMISSION) && targetEffective.size === 1) {
    for (const d of PERMISSION_REGISTRY) if (!hasEffectivePermission(callerEffective, d.key)) return false;
  }
  return true;
}

export function callerCanGrant(
  callerEffective: ReadonlySet<string>,
  requestedKeys: readonly string[],
): boolean {
  for (const key of requestedKeys) {
    if (!hasEffectivePermission(callerEffective, key)) return false;
  }
  return true;
}

export type TargetEffectiveResult =
  | { status: 'resolved'; effective: ReadonlySet<string> }
  | { status: 'not_found' }
  | { status: 'error'; cause: unknown };

export async function getTargetEffectivePermissions(adminId: number): Promise<TargetEffectiveResult> {
  if (!Number.isInteger(adminId)) return { status: 'not_found' };
  const { prisma } = await import('@/lib/prisma');
  try {
    const admin = await prisma.admins.findUnique({
      where: { id: adminId },
      select: {
        admin_groups: { select: { groups: { select: { group_permissions: { select: { permissions: { select: { key: true } } } } } } } },
        permission_overrides: { select: { effect: true, permissions: { select: { key: true } } } },
      },
    });
    if (!admin) return { status: 'not_found' };
    const keys: string[] = [];
    for (const m of admin.admin_groups) for (const l of m.groups.group_permissions) keys.push(l.permissions.key);
    const overrides: { permissionKey: string; effect: OverrideEffect }[] = admin.permission_overrides.map((o) => ({
      permissionKey: o.permissions.key, effect: o.effect === 'allow' ? 'allow' : 'deny',
    }));
    return { status: 'resolved', effective: resolveEffectivePermissions(keys, overrides) };
  } catch (cause: unknown) {
    return { status: 'error', cause };
  }
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
