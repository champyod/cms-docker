'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { ensurePermission, invalidateAccessCache } from '@/lib/permissions';
import type { OverrideEffect } from '@/lib/permission-engine';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export interface AdminAccessGroup {
  id: number;
  name: string;
}

export interface AdminAccessOverride {
  permissionKey: string;
  effect: OverrideEffect;
  reason: string | null;
}

export interface AdminAccess {
  groups: AdminAccessGroup[];
  overrides: AdminAccessOverride[];
}

export interface GroupWithPermissions {
  id: number;
  name: string;
  description: string | null;
  is_seeded: boolean;
  permissionKeys: string[];
}

export interface AdminAccessSummary {
  adminId: number;
  groupNames: string[];
  overrideCount: number;
}

function normaliseEffect(effect: string): OverrideEffect {
  // Why: a corrupt/legacy stored value must fail closed, so anything that is not an explicit "allow" is treated as a deny.
  return effect === 'allow' ? 'allow' : 'deny';
}

export async function getAdminAccess(adminId: number): Promise<ActionResult<AdminAccess>> {
  try {
    await ensurePermission('admin:read');
    const admin = await prisma.admins.findUnique({
      where: { id: adminId },
      select: {
        admin_groups: { select: { groups: { select: { id: true, name: true } } } },
        permission_overrides: {
          select: { effect: true, reason: true, permissions: { select: { key: true } } },
        },
      },
    });
    if (!admin) return { success: false, error: 'Admin not found' };

    return {
      success: true,
      data: {
        groups: admin.admin_groups.map((membership) => ({
          id: membership.groups.id,
          name: membership.groups.name,
        })),
        overrides: admin.permission_overrides.map((override) => ({
          permissionKey: override.permissions.key,
          effect: normaliseEffect(override.effect),
          reason: override.reason,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function setAdminGroups(
  adminId: number,
  groupIds: number[],
  reason: string,
): Promise<ActionResult<{ adminId: number }>> {
  try {
    await ensurePermission('group:assign');
    if (!reason.trim()) return { success: false, error: 'A reason is required to change group membership' };

    const before = await prisma.admin_groups.findMany({
      where: { admin_id: adminId },
      select: { group_id: true },
    });
    const beforeIds = before.map((row) => row.group_id).sort((a, b) => a - b);
    const targetIds = Array.from(new Set(groupIds)).sort((a, b) => a - b);

    await prisma.$transaction(async (tx) => {
      await tx.admin_groups.deleteMany({ where: { admin_id: adminId } });
      if (targetIds.length > 0) {
        await tx.admin_groups.createMany({
          data: targetIds.map((groupId) => ({ admin_id: adminId, group_id: groupId })),
        });
      }
    });

    await recordAudit({
      verb: 'admin_groups:set',
      entity: 'admin',
      entityId: String(adminId),
      beforeValues: { groupIds: beforeIds },
      afterValues: { groupIds: targetIds },
      reason,
      result: 'success',
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true, data: { adminId } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function setAdminOverride(
  adminId: number,
  permissionKey: string,
  effect: OverrideEffect,
  reason: string,
): Promise<ActionResult<{ adminId: number; permissionKey: string }>> {
  try {
    await ensurePermission('override:set');
    if (!reason.trim()) return { success: false, error: 'A reason is required for a permission override' };

    const permission = await prisma.permissions.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) return { success: false, error: `Unknown permission "${permissionKey}"` };

    const before = await prisma.admin_permission_overrides.findUnique({
      where: { admin_id_permission_id: { admin_id: adminId, permission_id: permission.id } },
      select: { effect: true, reason: true },
    });

    await prisma.admin_permission_overrides.upsert({
      where: { admin_id_permission_id: { admin_id: adminId, permission_id: permission.id } },
      create: { admin_id: adminId, permission_id: permission.id, effect, reason },
      update: { effect, reason },
    });

    await recordAudit({
      verb: 'override:set',
      entity: 'admin',
      entityId: String(adminId),
      beforeValues: before ?? { effect: null, reason: null },
      afterValues: { permissionKey, effect, reason },
      reason,
      result: 'success',
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true, data: { adminId, permissionKey } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function clearAdminOverride(
  adminId: number,
  permissionKey: string,
): Promise<ActionResult<{ adminId: number; permissionKey: string }>> {
  try {
    await ensurePermission('override:set');
    const permission = await prisma.permissions.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) return { success: false, error: `Unknown permission "${permissionKey}"` };

    const before = await prisma.admin_permission_overrides.findUnique({
      where: { admin_id_permission_id: { admin_id: adminId, permission_id: permission.id } },
      select: { effect: true, reason: true },
    });
    if (!before) return { success: true, data: { adminId, permissionKey } };

    await prisma.admin_permission_overrides.delete({
      where: { admin_id_permission_id: { admin_id: adminId, permission_id: permission.id } },
    });

    await recordAudit({
      verb: 'override:clear',
      entity: 'admin',
      entityId: String(adminId),
      beforeValues: { permissionKey, effect: before.effect, reason: before.reason },
      reason: 'Per-person override removed',
      result: 'success',
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true, data: { adminId, permissionKey } };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function listGroupsWithPermissions(): Promise<ActionResult<GroupWithPermissions[]>> {
  try {
    await ensurePermission('group:read');
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
    return {
      success: true,
      data: rows.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        is_seeded: group.is_seeded,
        permissionKeys: group.group_permissions.map((link) => link.permissions.key),
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Per-admin group names and override counts for the admin list badges (avoids a per-row round trip). */
export async function listAdminsAccessSummary(): Promise<ActionResult<AdminAccessSummary[]>> {
  try {
    await ensurePermission('admin:read');
    const rows = await prisma.admins.findMany({
      orderBy: { username: 'asc' },
      select: {
        id: true,
        admin_groups: { select: { groups: { select: { name: true } } } },
        _count: { select: { permission_overrides: true } },
      },
    });
    return {
      success: true,
      data: rows.map((admin) => ({
        adminId: admin.id,
        groupNames: admin.admin_groups.map((membership) => membership.groups.name),
        overrideCount: admin._count.permission_overrides,
      })),
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
