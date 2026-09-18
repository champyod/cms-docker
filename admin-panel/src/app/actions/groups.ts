'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { recordAudit, assertReasonForDestructive } from '@/lib/audit';
import { ensurePermission, invalidateAccessCache } from '@/lib/permissions';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface GroupListRow {
  id: number;
  name: string;
  description: string | null;
  is_seeded: boolean;
  permissionCount: number;
}

async function resolvePermissionIds(permissionKeys: readonly string[]): Promise<number[]> {
  if (permissionKeys.length === 0) return [];
  const rows = await prisma.permissions.findMany({
    where: { key: { in: [...permissionKeys] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function affectedAdminIds(groupId: number): Promise<number[]> {
  const rows = await prisma.admin_groups.findMany({
    where: { group_id: groupId },
    select: { admin_id: true },
  });
  return rows.map((row) => row.admin_id);
}

function invalidateAdmins(adminIds: readonly number[]): void {
  for (const adminId of adminIds) {
    invalidateAccessCache(String(adminId));
  }
}

export async function createGroup(
  name: string,
  description: string,
  permissionKeys: string[],
  reason: string,
): Promise<ActionResult<{ id: number }>> {
  try {
    await ensurePermission('group:create');
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'A group name is required' };

    const permissionIds = await resolvePermissionIds(permissionKeys);
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.groups.create({
        data: { name: trimmedName, description: description.trim() || null },
        select: { id: true },
      });
      if (permissionIds.length > 0) {
        await tx.group_permissions.createMany({
          data: permissionIds.map((permissionId) => ({ group_id: created.id, permission_id: permissionId })),
        });
      }
      return created;
    });

    await recordAudit({
      verb: 'group:create',
      entity: 'group',
      entityId: String(group.id),
      afterValues: { name: trimmedName, description, permissionKeys },
      reason,
      result: 'success',
    });
    revalidatePath('/[locale]/permissions', 'page');
    return { success: true, data: { id: group.id } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateGroup(
  id: number,
  name: string,
  description: string,
  permissionKeys: string[],
  reason: string,
): Promise<ActionResult<{ id: number }>> {
  try {
    await ensurePermission('group:update');
    const trimmedName = name.trim();
    if (!trimmedName) return { success: false, error: 'A group name is required' };

    const existing = await prisma.groups.findUnique({
      where: { id },
      select: {
        name: true,
        description: true,
        group_permissions: { select: { permissions: { select: { key: true } } } },
      },
    });
    if (!existing) return { success: false, error: 'Group not found' };

    // Why: Superadmin is name-keyed and anchors _is_superadmin / wouldRemoveLastSuperadmin detection — renaming it would silently orphan every superadmin
    if (existing.name === 'Superadmin' && trimmedName !== 'Superadmin') {
      return {
        success: false,
        error: 'Cannot rename the Superadmin group — it is name-keyed and anchors superadmin detection',
      };
    }

    // Why: removing all:all from Superadmin would silently strip every superadmin at once
    if (existing.name === 'Superadmin' && !permissionKeys.includes('all:all')) {
      return {
        success: false,
        error: 'Cannot remove "all:all" from the Superadmin group — it would strip every superadmin at once',
      };
    }

    const beforeKeys = existing.group_permissions.map((link) => link.permissions.key);
    const permissionIds = await resolvePermissionIds(permissionKeys);
    await prisma.$transaction(async (tx) => {
      await tx.groups.update({
        where: { id },
        data: { name: trimmedName, description: description.trim() || null },
      });
      await tx.group_permissions.deleteMany({ where: { group_id: id } });
      if (permissionIds.length > 0) {
        await tx.group_permissions.createMany({
          data: permissionIds.map((permissionId) => ({ group_id: id, permission_id: permissionId })),
        });
      }
    });

    await recordAudit({
      verb: 'group:update',
      entity: 'group',
      entityId: String(id),
      beforeValues: { name: existing.name, description: existing.description, permissionKeys: beforeKeys },
      afterValues: { name: trimmedName, description, permissionKeys },
      reason,
      result: 'success',
    });
    invalidateAdmins(await affectedAdminIds(id));
    revalidatePath('/[locale]/permissions', 'page');
    return { success: true, data: { id } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteGroup(id: number, reason: string): Promise<ActionResult<{ id: number }>> {
  try {
    await ensurePermission('group:delete');
    const destructive = assertReasonForDestructive('group:delete', reason);
    if (!destructive.ok) return { success: false, error: destructive.error };

    const existing = await prisma.groups.findUnique({
      where: { id },
      select: {
        name: true,
        description: true,
        is_seeded: true,
        group_permissions: { select: { permissions: { select: { key: true } } } },
      },
    });
    if (!existing) return { success: false, error: 'Group not found' };

    // Why: Superadmin is name-keyed and anchors _is_superadmin / wouldRemoveLastSuperadmin detection — deleting it would orphan every superadmin and make last-superadmin guards silently return false while all:all persists on former members
    if (existing.name === 'Superadmin') {
      return {
        success: false,
        error: 'Cannot delete the Superadmin group — it is name-keyed and anchors superadmin detection',
      };
    }

    const adminIds = await affectedAdminIds(id);
    // Why: deleting a group cascades only the admin_groups and group_permissions links — the permission
    // rows are shared definitions and must survive, and seeded groups are ordinary rows with no guard (except the Superadmin anchor).
    await prisma.groups.delete({ where: { id } });

    await recordAudit({
      verb: 'group:delete',
      entity: 'group',
      entityId: String(id),
      beforeValues: {
        name: existing.name,
        description: existing.description,
        is_seeded: existing.is_seeded,
        permissionKeys: existing.group_permissions.map((link) => link.permissions.key),
      },
      reason,
      result: 'success',
    });
    invalidateAdmins(adminIds);
    revalidatePath('/[locale]/permissions', 'page');
    return { success: true, data: { id } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function listGroups(): Promise<ActionResult<GroupListRow[]>> {
  try {
    await ensurePermission('group:read');
    const rows = await prisma.groups.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        is_seeded: true,
        _count: { select: { group_permissions: true } },
      },
    });
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        is_seeded: row.is_seeded,
        permissionCount: row._count.group_permissions,
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
