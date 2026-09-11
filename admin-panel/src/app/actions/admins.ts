'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions, invalidateAccessCache } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { getSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { safeAdminSelect, type AdminWithLogin } from '@/lib/prisma-selects';
import {
  formatStoredPassword,
  parseStoredPassword,
  DEFAULT_PASSWORD_KIND,
  type PasswordKind,
} from '@/lib/password-format';

interface ActionResult {
  success: boolean;
  error?: string;
}

interface AdminPermissionAssignment {
  groupIds?: number[];
  overrides?: { permissionKey: string; effect: 'allow' | 'deny' }[];
}

interface CreateAdminInput extends AdminPermissionAssignment {
  name: string;
  username: string;
  password: string;
  passwordKind?: PasswordKind;
}

interface UpdateAdminInput extends AdminPermissionAssignment {
  name?: string;
  enabled?: boolean;
  password?: string;
  passwordKind?: PasswordKind;
}

type AdminUpdateData = {
  name?: string;
  enabled?: boolean;
  authentication?: string;
};

export async function getAdmins(): Promise<AdminWithLogin[]> {
  await ensurePermission('admin:read');
  return prisma.admins.findMany({
    select: { ...safeAdminSelect, last_login_at: true },
    orderBy: { username: 'asc' }
  });
}

export async function createAdmin(data: CreateAdminInput): Promise<ActionResult> {
  await ensurePermission('admin:create');
  // WHY: creation is gated by `admin:create`; stripDisallowedFields models the UPDATE contract (per-field `update` keys) and must not be applied to create payloads
  try {
    const created = await prisma.admins.create({
      data: {
        name: data.name,
        username: data.username,
        authentication: await formatStoredPassword(data.passwordKind ?? DEFAULT_PASSWORD_KIND, data.password),
        enabled: true,
      },
      select: { id: true },
    });
    await recordAudit({
      verb: 'admin:create',
      entity: 'admin',
      entityId: String(created.id),
      afterValues: { username: data.username, name: data.name },
      result: 'success',
    });
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Admin username already exists' };
    }
    return { success: false, error: e.message };
  }
}

function findAdminTarget(adminId: number) {
  return prisma.admins.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      enabled: true,
      admin_groups: { select: { groups: { select: { id: true, name: true } } } },
    },
  });
}

type AdminTarget = Awaited<ReturnType<typeof findAdminTarget>>;

function isSelfDemotion(
  sessionUserId: string,
  adminId: number,
  target: AdminTarget,
  data: UpdateAdminInput
): boolean {
  if (sessionUserId !== String(adminId) || !target) return false;
  const isSuper = target.admin_groups.some((ag) => ag.groups.name === 'Superadmin');
  return isSuper && (data.enabled === false || removesSuperadminStatusViaGroups(target, data));
}

function isCurrentlySuperadmin(target: AdminTarget): boolean {
  return (target?.admin_groups.some((ag) => ag.groups.name === 'Superadmin')) ?? false;
}

function removesSuperadminStatusViaGroups(target: AdminTarget, data: UpdateAdminInput): boolean {
  if (!target || !isCurrentlySuperadmin(target)) return false;
  if (data.enabled === false) return true;
  if (data.groupIds !== undefined) {
    const superadminGroup = target.admin_groups.find((ag) => ag.groups.name === 'Superadmin');
    return superadminGroup !== undefined && !data.groupIds.includes(superadminGroup.groups.id);
  }
  return false;
}

async function wouldRemoveLastSuperadmin(adminId: number): Promise<boolean> {
  const otherSupers = await prisma.admins.count({
    where: {
      enabled: true,
      NOT: { id: adminId },
      admin_groups: { some: { groups: { name: 'Superadmin' } } },
    },
  });
  return otherSupers === 0;
}

async function buildAdminUpdateData(data: UpdateAdminInput): Promise<AdminUpdateData> {
  const updateData: AdminUpdateData = {};
  if (data.name) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.password) updateData.authentication = await formatStoredPassword(data.passwordKind ?? DEFAULT_PASSWORD_KIND, data.password);
  return updateData;
}

export async function updateAdmin(adminId: number, data: UpdateAdminInput): Promise<ActionResult> {
  await ensurePermission('admin:update');
  // Why: server-side guard — never write a field the caller cannot update, even if the client sends it
  const effectivePermissions = await getPermissions();
  const allowed = stripDisallowedFields('admins', data as Record<string, unknown>, effectivePermissions);

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  const target = await findAdminTarget(adminId);
  if (isSelfDemotion(session.userId, adminId, target, data)) {
    return { success: false, error: 'Cannot demote your own superadmin account' };
  }

  // WHY: prevent the last superadmin from being demoted or disabled
  if (isCurrentlySuperadmin(target) && removesSuperadminStatusViaGroups(target, data)) {
    if (await wouldRemoveLastSuperadmin(adminId)) {
      return { success: false, error: 'Cannot remove the last superadmin' };
    }
  }

  try {
    const beforeAdmin = await prisma.admins.findUnique({ where: { id: adminId }, select: { name: true, enabled: true, username: true } });
    await prisma.admins.update({
      where: { id: adminId },
      data: await buildAdminUpdateData(allowed as unknown as UpdateAdminInput)
    });
    await recordAudit({
      verb: 'admin:update',
      entity: 'admin',
      entityId: String(adminId),
      beforeValues: beforeAdmin ? { name: beforeAdmin.name, enabled: beforeAdmin.enabled, username: beforeAdmin.username } : undefined,
      afterValues: { changedKeys: Object.keys(allowed as Record<string, unknown>) },
      result: 'success',
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deleteAdmin(adminId: number): Promise<ActionResult> {
  await ensurePermission('admin:delete');

  const session = await getSession();
  if (!session) {
    return { success: false, error: 'Not authenticated' };
  }

  if (session.userId === String(adminId)) {
    return { success: false, error: 'Cannot delete your own account' };
  }

  const target = await findAdminTarget(adminId);
  // WHY: deleting a superadmin removes superadmin status — block if this is the last one
  if (isCurrentlySuperadmin(target) && await wouldRemoveLastSuperadmin(adminId)) {
    return { success: false, error: 'Cannot remove the last superadmin' };
  }

  try {
    const beforeDelete = await prisma.admins.findUnique({ where: { id: adminId }, select: { username: true, name: true, enabled: true } });
    await prisma.admins.delete({ where: { id: adminId } });
    await recordAudit({
      verb: 'admin:delete',
      entity: 'admin',
      entityId: String(adminId),
      beforeValues: beforeDelete ? { username: beforeDelete.username, name: beforeDelete.name, enabled: beforeDelete.enabled } : undefined,
      result: 'success',
    });
    invalidateAccessCache(String(adminId));
    revalidatePath('/[locale]/admins', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function revealAdminPassword(id: number): Promise<
  { success: true; kind: 'plaintext'; value: string } | { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('password:reveal');
  try {
    const row = await prisma.admins.findUnique({ where: { id }, select: { authentication: true } });
    if (!row) return { success: false, error: 'Admin not found' };
    const parsed = parseStoredPassword(row.authentication);
    if (parsed.kind === 'bcrypt') return { success: true, kind: 'bcrypt' };
    return { success: true, kind: 'plaintext', value: parsed.value };
  } catch {
    return { success: false, error: 'Unable to load password' };
  }
}
