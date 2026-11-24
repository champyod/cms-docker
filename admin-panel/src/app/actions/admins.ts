'use server'

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { stripDisallowedFields } from '@/lib/field-permissions';
import {
  hasEffectivePermission,
  isEffectiveSuperset,
  ACTION_PERMISSIONS,
} from '@/lib/permission-engine';
// Resolving grants needs Prisma, and permission-engine.ts is imported by client components.
import { getTargetEffectivePermissions } from '@/lib/server/target-permissions';
import { ensurePermission, getPermissions, invalidateAccessCache } from '@/lib/permissions';
import { type ListSortInput } from '@/lib/list-sorting';
import { adminSortOrderBy } from '@/lib/admin-sorting';
import { prisma } from '@/lib/prisma';
import { safeAdminSelect, type AdminWithLogin } from '@/lib/prisma-selects';
import {
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
import { ROOT_ACTOR_USERNAME } from '@/lib/permission-groups';
import { handleAdminUpdateWrite } from './admin-update-helpers';

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


export async function getAdmins(sort?: ListSortInput): Promise<AdminWithLogin[]> {
  await ensurePermission('admin:read');
  return prisma.admins.findMany({
    select: { ...safeAdminSelect, last_login_at: true },
    orderBy: adminSortOrderBy(sort ?? null)
  });
}

export async function createAdmin(data: CreateAdminInput): Promise<ActionResult> {
  await ensurePermission(ACTION_PERMISSIONS.createAdmin);
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
    revalidatePath('/[locale]/administration/admins', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Admin username already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateAdmin(adminId: number, data: UpdateAdminInput): Promise<ActionResult> {
  // The write is gated per field, so a caller with only admin:password:update can still reset a credential.
  const effectivePermissions = await getPermissions();
  const allowed = stripDisallowedFields('admins', data as Record<string, unknown>, effectivePermissions);

  const mayUpdateAdmin = hasEffectivePermission(effectivePermissions, ACTION_PERMISSIONS.updateAdmin);
  const mayUpdatePassword = hasEffectivePermission(effectivePermissions, ACTION_PERMISSIONS.setAdminPassword);
  if (!mayUpdateAdmin && !mayUpdatePassword) {
    return { success: false, error: 'Not authorized' };
  }
  if (Object.keys(allowed).length === 0) {
    return { success: false, error: 'You do not have permission to change these fields' };
  }

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

  // Re-enabling the system actor would hand a root login attempt to the verifier, so the row stays disabled.
  if (target?.username === ROOT_ACTOR_USERNAME && allowed.enabled !== undefined) {
    return { success: false, error: 'Cannot change the enabled flag of the system actor' };
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
  await ensurePermission(ACTION_PERMISSIONS.deleteAdmin);

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
  // Why: deleting a superadmin removes superadmin status — block if this is the last one
  if (isCurrentlySuperadmin(target) && await wouldRemoveLastSuperadmin(adminId)) {
    return { success: false, error: 'Cannot remove the last superadmin' };
  }

  // Every script-side action logs under the system actor's id, so the row is insert-only.
  if (target?.username === ROOT_ACTOR_USERNAME) {
    return { success: false, error: 'Cannot delete the system actor: script-side action attribution resolves through it' };
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
    revalidatePath('/[locale]/administration/admins', 'page');
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
    if (!row) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'admin',
        entityId: String(id),
        beforeValues: { adminId: id },
        // The failure happened before any secret was read, so the log carries a named reason instead of the driver's message.
        afterValues: { error: 'NotFound' },
        result: 'failure',
      });
      return { success: false, error: 'Admin not found' };
    }
    const parsed = parseStoredPassword(row.authentication);
    // The audit row records the disclosure kind, never the secret itself.
    await recordAudit({
      verb: 'password:reveal',
      entity: 'admin',
      entityId: String(id),
      beforeValues: { adminId: id },
      afterValues: { kind: parsed.kind },
      result: 'success',
    });
    if (parsed.kind === 'bcrypt') return { success: true, kind: 'bcrypt' };
    return { success: true, kind: 'plaintext', value: parsed.value };
  } catch (error) {
    // A failed reveal is the shape a break-in takes, so the error name is the whole payload; a message could carry the refused query.
    await recordAudit({
      verb: 'password:reveal',
      entity: 'admin',
      entityId: String(id),
      beforeValues: { adminId: id },
      afterValues: { error: error instanceof Error ? error.name : 'UnknownError' },
      result: 'failure',
    });
    return { success: false, error: 'Unable to load password' };
  }
}
