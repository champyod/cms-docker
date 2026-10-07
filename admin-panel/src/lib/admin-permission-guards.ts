import { callerCanGrant, resolveEffectivePermissions, type PermissionOverride } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';

function toOverride(
  effect: string,
  permissionKey: string,
): PermissionOverride {
  return {
    permissionKey,
    effect: effect === 'allow' ? 'allow' : 'deny',
  };
}

async function groupKeysForIds(groupIds: number[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const rows = await prisma.groups.findMany({
    where: { id: { in: groupIds } },
    select: { group_permissions: { select: { permissions: { select: { key: true } } } } },
  });
  const keys: string[] = [];
  for (const group of rows) for (const link of group.group_permissions) keys.push(link.permissions.key);
  return keys;
}

async function overridesForAdmin(adminId: number): Promise<PermissionOverride[]> {
  const admin = await prisma.admins.findUnique({
    where: { id: adminId },
    select: { permission_overrides: { select: { effect: true, permissions: { select: { key: true } } } } },
  });
  if (!admin) return [];
  return admin.permission_overrides.map((row) => toOverride(row.effect, row.permissions.key));
}

async function groupKeysForAdmin(adminId: number): Promise<string[]> {
  const admin = await prisma.admins.findUnique({
    where: { id: adminId },
    select: {
      admin_groups: { select: { groups: { select: { group_permissions: { select: { permissions: { select: { key: true } } } } } } } },
    },
  });
  if (!admin) return [];
  const keys: string[] = [];
  for (const membership of admin.admin_groups)
    for (const link of membership.groups.group_permissions) keys.push(link.permissions.key);
  return keys;
}

export async function effectiveAfterGroupChange(
  adminId: number,
  targetGroupIds: number[],
): Promise<ReadonlySet<string> | null> {
  try {
    const [groupKeys, overrides] = await Promise.all([
      groupKeysForIds(targetGroupIds),
      overridesForAdmin(adminId),
    ]);
    return resolveEffectivePermissions(groupKeys, overrides);
  } catch {
    return null;
  }
}

export async function effectiveAfterOverride(
  adminId: number,
  permissionKey: string,
  effect: 'allow' | 'deny',
): Promise<ReadonlySet<string> | null> {
  try {
    const [groupKeys, existingOverrides] = await Promise.all([
      groupKeysForAdmin(adminId),
      overridesForAdmin(adminId),
    ]);
    const filtered = existingOverrides.filter((override) => override.permissionKey !== permissionKey);
    filtered.push({ permissionKey, effect });
    return resolveEffectivePermissions(groupKeys, filtered);
  } catch {
    return null;
  }
}

export function canCallerGrantResult(
  callerEffective: ReadonlySet<string>,
  resultingEffective: ReadonlySet<string>,
): boolean {
  return callerCanGrant(callerEffective, [...resultingEffective]);
}
