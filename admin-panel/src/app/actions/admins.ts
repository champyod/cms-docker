'use server'

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { stripDisallowedFields } from '@/lib/field-permissions';
import {
  getTargetEffectivePermissions,
  isEffectiveSuperset,
} from '@/lib/permission-engine';
import { ensurePermission, getPermissions, invalidateAccessCache } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { safeAdminSelect, type AdminWithLogin } from '@/lib/prisma-selects';
import {
  buildAdminUpdateData,
  findAdminTarget,
  isCurrentlySuperadmin,
  isSelfDemotion,
  removesSuperadminStatusViaGroups,
  wouldRemoveLastSuperadmin,
  type UpdateAdminInput,
} from '@/lib/admin-helpers';
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

interface AdminMutationError {
  success: false;
  error: string;
}

type AdminMutationGuard = null | AdminMutationError;

async function guardAdminMutation(
  callerEffective: ReadonlySet<string>,
  adminId: number,
  sessionUserId: string,
): Promise<AdminMutationGuard> {
  // Why: a caller may only mutate admins whose permissions are a subset of their own
  if (String(adminId) === sessionUserId) return null;
  const targetResult = await getTargetEffectivePermissions(adminId);
  if (targetResult.status === 'not_found') return null;
  if (targetResult.status === 'error') {
    return { success: false, error: 'Unable to verify target permissions' };
  }
  if (!isEffectiveSuperset(callerEffective, targetResult.effective)) {
    return { success: false, error: 'Cannot mutate an admin with permissions you do not hold' };
  }
  return null;
}

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


async function handleAdminUpdateWrite(
  adminId: number,
  allowed: Record<string, unknown>,
): Promise<void> {
  const beforeAdmin = await prisma.admins.findUnique({
    where: { id: adminId },
    select: { name: true, enabled: true, username: true },
  });
  await prisma.admins.update({
    where: { id: adminId },
    data: await buildAdminUpdateData(allowed as unknown as UpdateAdminInput),
  });
  await recordAudit({
    verb: 'admin:update',
    entity: 'admin',
    entityId: String(adminId),
    beforeValues: beforeAdmin
      ? { name: beforeAdmin.name, enabled: beforeAdmin.enabled, username: beforeAdmin.username }
      : undefined,
    afterValues: { changedKeys: Object.keys(allowed) },
    result: 'success',
  });
  invalidateAccessCache(String(adminId));
  revalidatePath('/[locale]/admins', 'page');
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

  const mutationError = await guardAdminMutation(effectivePermissions, adminId, session.userId);
  if (mutationError) return mutationError;

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
    await handleAdminUpdateWrite(adminId, allowed as Record<string, unknown>);
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

  const callerEffective = await getPermissions();
  const mutationError = await guardAdminMutation(callerEffective, adminId, session.userId);
  if (mutationError) return mutationError;

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
