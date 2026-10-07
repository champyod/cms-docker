import { prisma } from '@/lib/prisma';
import { normaliseEffect, type AdminAccess, type AdminAccessSummary, type GroupWithPermissions } from '@/lib/admin-access-types';

export async function fetchAdminAccess(adminId: number): Promise<AdminAccess | null> {
  const admin = await prisma.admins.findUnique({
    where: { id: adminId },
    select: {
      admin_groups: { select: { groups: { select: { id: true, name: true } } } },
      permission_overrides: {
        select: { effect: true, reason: true, permissions: { select: { key: true } } },
      },
    },
  });
  if (!admin) return null;
  return {
    groups: admin.admin_groups.map((membership) => ({
      id: membership.groups.id,
      name: membership.groups.name,
    })),
    overrides: admin.permission_overrides.map((override) => ({
      permissionKey: override.permissions.key,
      effect: normaliseEffect(override.effect),
      reason: override.reason,
    })),
  };
}

export async function fetchGroupsWithPermissions(): Promise<GroupWithPermissions[]> {
  const rows = await prisma.groups.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      is_seeded: true,
      group_permissions: { select: { permissions: { select: { key: true } } } },
    },
  });
  return rows.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    is_seeded: group.is_seeded,
    permissionKeys: group.group_permissions.map((link) => link.permissions.key),
  }));
}

export async function fetchAdminsAccessSummary(): Promise<AdminAccessSummary[]> {
  const rows = await prisma.admins.findMany({
    orderBy: { username: 'asc' },
    select: {
      id: true,
      admin_groups: { select: { groups: { select: { name: true } } } },
      _count: { select: { permission_overrides: true } },
    },
  });
  return rows.map((admin) => ({
    adminId: admin.id,
    groupNames: admin.admin_groups.map((membership) => membership.groups.name),
    overrideCount: admin._count.permission_overrides,
  }));
}
