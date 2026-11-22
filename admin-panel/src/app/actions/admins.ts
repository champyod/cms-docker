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
// Server module: resolving another admin's grants needs Prisma, and permission-engine is client-imported.
import { getTargetEffectivePermissions } from '@/lib/server/target-permissions';
import { ensurePermission, getPermissions, invalidateAccessCache } from '@/lib/permissions';
import { type ListSortInput } from '@/lib/list-sorting';
import { adminSortOrderBy } from '@/lib/admin-sorting';
import { getAdminReadClient, getAdminSecurityClient } from '@/lib/prisma';
import { safeAdminSelect, type AdminWithLogin } from '@/lib/prisma-selects';
import {
  findAdminTarget,
  isCurrentlySuperadmin,
  isSelfDemotion,
  removesSuperadminStatusViaGroups,
  wouldRemoveLastSuperadmin,
  type UpdateAdminInput,
} from '@/lib/admin-helpers';
import { formatBcryptPassword } from '@/lib/password-format';
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
  // Read role: the one admin read every admin:read holder runs, so its column-scoped SELECT is what keeps credentials unreachable.
  return getAdminReadClient().admins.findMany({
    select: { ...safeAdminSelect, last_login_at: true },
    orderBy: adminSortOrderBy(sort ?? null)
  });
}

export async function createAdmin(data: CreateAdminInput): Promise<ActionResult> {
  await ensurePermission(ACTION_PERMISSIONS.createAdmin);
  // WHY: creation is gated by `admin:create`; stripDisallowedFields models the UPDATE contract (per-field `update` keys) and must not be applied to create payloads
  try {
    const created = await getAdminSecurityClient().admins.create({
      data: {
        name: data.name,
        username: data.username,
        authentication: await formatBcryptPassword(data.password),
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
  // Per-field gating: a caller with only admin:password:update can reset a credential while other fields are stripped.
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

  // Keep the system actor disabled: it is passwordless, so re-enabling it hands a root login to the verifier.
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

  // The system actor is insert-only attribution infrastructure: no delete path exists.
  if (target?.username === ROOT_ACTOR_USERNAME) {
    return { success: false, error: 'Cannot delete the system actor — script-side action attribution resolves through it' };
  }

  try {
    const security = getAdminSecurityClient();
    const beforeDelete = await security.admins.findUnique({ where: { id: adminId }, select: { username: true, name: true, enabled: true } });
    // Explicit select: the role cannot read last_login_at, so a bare delete's RETURNING would be refused.
    await security.admins.delete({ where: { id: adminId }, select: { id: true } });
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
  { success: true; kind: 'bcrypt' } | { success: false; error: string }
> {
  await ensurePermission('password:reveal');
  try {
    const row = await getAdminSecurityClient().admins.findUnique({ where: { id }, select: { authentication: true } });
    if (!row) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'admin',
        entityId: String(id),
        beforeValues: { adminId: id },
        // A named reason, not a message: this failed before any secret was read.
        afterValues: { error: 'NotFound' },
        result: 'failure',
      });
      return { success: false, error: 'Admin not found' };
    }
    // Admin credentials are bcrypt-only. A legacy plaintext/unprefixed value is never returned or revealed.
    if (!row.authentication.startsWith('bcrypt:')) {
      await recordAudit({
        verb: 'password:reveal',
        entity: 'admin',
        entityId: String(id),
        beforeValues: { adminId: id },
        afterValues: { error: 'UnsupportedCredentialFormat' },
        result: 'failure',
      });
      return { success: false, error: 'This password is stored in an unsupported format; reset it.' };
    }
    await recordAudit({
      verb: 'password:reveal',
      entity: 'admin',
      entityId: String(id),
      beforeValues: { adminId: id },
      afterValues: { kind: 'bcrypt' },
      result: 'success',
    });
    return { success: true, kind: 'bcrypt' };
  } catch (error) {
    // The error name is the whole payload: a message here can carry the refused query.
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
