import { prisma } from '@/lib/prisma';
import { formatBcryptPassword } from '@/lib/password-format';

export type AdminTarget = Awaited<ReturnType<typeof findAdminTarget>>;

export interface UpdateAdminInput {
  name?: string;
  enabled?: boolean;
  password?: string;
  groupIds?: number[];
  overrides?: { permissionKey: string; effect: 'allow' | 'deny' }[];
}

export type AdminUpdateData = {
  name?: string;
  enabled?: boolean;
  authentication?: string;
};

export function findAdminTarget(adminId: number) {
  return prisma.admins.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      enabled: true,
      username: true,
      admin_groups: { select: { groups: { select: { id: true, name: true } } } },
    },
  });
}

export function isSelfDemotion(
  sessionUserId: string,
  adminId: number,
  target: AdminTarget,
  data: UpdateAdminInput,
): boolean {
  if (sessionUserId !== String(adminId) || !target) return false;
  const isSuper = target.admin_groups.some((ag) => ag.groups.name === 'Superadmin');
  return isSuper && (data.enabled === false || removesSuperadminStatusViaGroups(target, data));
}

export function isCurrentlySuperadmin(target: AdminTarget): boolean {
  return (target?.admin_groups.some((ag) => ag.groups.name === 'Superadmin')) ?? false;
}

export function removesSuperadminStatusViaGroups(
  target: AdminTarget,
  data: UpdateAdminInput,
): boolean {
  if (!target || !isCurrentlySuperadmin(target)) return false;
  if (data.enabled === false) return true;
  if (data.groupIds !== undefined) {
    const superadminGroup = target.admin_groups.find((ag) => ag.groups.name === 'Superadmin');
    return superadminGroup !== undefined && !data.groupIds.includes(superadminGroup.groups.id);
  }
  return false;
}

export async function wouldRemoveLastSuperadmin(adminId: number): Promise<boolean> {
  const otherSupers = await prisma.admins.count({
    where: {
      enabled: true,
      NOT: { id: adminId },
      admin_groups: { some: { groups: { name: 'Superadmin' } } },
    },
  });
  return otherSupers === 0;
}

/**
 * Whether this write would leave the system with no enabled Superadmin.
 *
 * WHY one predicate for both writers: `updateAdmin` edits groups inside a larger field set and
 * `setAdminGroups` replaces them outright. Two copies of "does this keep a superadmin" is how
 * one of them came to omit the check entirely; the caller passes whichever view of the change
 * it holds and the rule is decided here once.
 */
export async function wouldLeaveNoSuperadmin(
  adminId: number,
  target: AdminTarget,
  data: UpdateAdminInput,
): Promise<boolean> {
  if (!target || !removesSuperadminStatusViaGroups(target, data)) return false;
  return wouldRemoveLastSuperadmin(adminId);
}

export async function buildAdminUpdateData(data: UpdateAdminInput): Promise<AdminUpdateData> {
  const updateData: AdminUpdateData = {};
  if (data.name) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.password) updateData.authentication = await formatBcryptPassword(data.password);
  return updateData;
}
