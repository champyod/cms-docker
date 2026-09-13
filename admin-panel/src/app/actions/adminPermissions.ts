'use server';

import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import {
  fetchAdminAccess,
  fetchAdminsAccessSummary,
  fetchGroupsWithPermissions,
} from '@/lib/admin-access-queries';
import {
  canCallerGrantResult,
  effectiveAfterGroupChange,
  effectiveAfterOverride,
} from '@/lib/admin-permission-guards';
import { ensurePermission, getPermissions, invalidateAccessCache } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { OverrideEffect } from '@/lib/permission-engine';
import type { ActionResult, AdminAccess, AdminAccessSummary, GroupWithPermissions } from '@/lib/admin-access-types';

export type {
  ActionResult,
  AdminAccess,
  AdminAccessGroup,
  AdminAccessOverride,
  AdminAccessSummary,
  GroupWithPermissions,
} from '@/lib/admin-access-types';

export async function getAdminAccess(adminId: number): Promise<ActionResult<AdminAccess>> {
  try {
    await ensurePermission('admin:read');
    const data = await fetchAdminAccess(adminId);
    if (!data) return { success: false, error: 'Admin not found' };
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function assertGroupChangeAllowed(adminId: number, groupIds: number[]): Promise<string | null> {
  // Why: check the resulting effective set, not the delta, so existing permissions cannot be laundered via partial changes
  const callerEffective = await getPermissions();
  const targetIds = Array.from(new Set(groupIds)).sort((a, b) => a - b);
  const resultingEffective = await effectiveAfterGroupChange(adminId, targetIds);
  if (resultingEffective && !canCallerGrantResult(callerEffective, resultingEffective)) {
    return 'Cannot grant permissions you do not hold';
  }
  return null;
}

async function applyGroupChange(adminId: number, targetIds: number[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.admin_groups.deleteMany({ where: { admin_id: adminId } });
    if (targetIds.length > 0) {
      await tx.admin_groups.createMany({
        data: targetIds.map((groupId) => ({ admin_id: adminId, group_id: groupId })),
      });
    }
  });
}

export async function setAdminGroups(
  adminId: number,
  groupIds: number[],
  reason: string,
): Promise<ActionResult<{ adminId: number }>> {
  try {
    await ensurePermission('group:assign');
    if (!reason.trim()) return { success: false, error: 'A reason is required to change group membership' };

    const denied = await assertGroupChangeAllowed(adminId, groupIds);
    if (denied) return { success: false, error: denied };

    const before = await prisma.admin_groups.findMany({
      where: { admin_id: adminId },
      select: { group_id: true },
    });
    const beforeIds = before.map((row) => row.group_id).sort((a, b) => a - b);
    const targetIds = Array.from(new Set(groupIds)).sort((a, b) => a - b);

    await applyGroupChange(adminId, targetIds);

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

async function assertOverrideAllowed(
  adminId: number,
  permissionKey: string,
  effect: OverrideEffect,
): Promise<string | null> {
  if (effect !== 'allow') return null;
  const callerEffective = await getPermissions();
  const resultingEffective = await effectiveAfterOverride(adminId, permissionKey, effect);
  if (resultingEffective && !canCallerGrantResult(callerEffective, resultingEffective)) {
    return 'Cannot grant permissions you do not hold';
  }
  return null;
}

async function writeOverride(
  adminId: number,
  permissionKey: string,
  effect: OverrideEffect,
  reason: string,
  permissionId: number,
): Promise<void> {
  const before = await prisma.admin_permission_overrides.findUnique({
    where: { admin_id_permission_id: { admin_id: adminId, permission_id: permissionId } },
    select: { effect: true, reason: true },
  });
  await prisma.admin_permission_overrides.upsert({
    where: { admin_id_permission_id: { admin_id: adminId, permission_id: permissionId } },
    create: { admin_id: adminId, permission_id: permissionId, effect, reason },
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

    const denied = await assertOverrideAllowed(adminId, permissionKey, effect);
    if (denied) return { success: false, error: denied };

    const permission = await prisma.permissions.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) return { success: false, error: `Unknown permission "${permissionKey}"` };

    await writeOverride(adminId, permissionKey, effect, reason, permission.id);
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
    const data = await fetchGroupsWithPermissions();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Per-admin group names and override counts for the admin list badges (avoids a per-row round trip). */
export async function listAdminsAccessSummary(): Promise<ActionResult<AdminAccessSummary[]>> {
  try {
    await ensurePermission('admin:read');
    const data = await fetchAdminsAccessSummary();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
