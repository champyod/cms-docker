import { createAdmin, updateAdmin, getAdmins } from '@/app/actions/admins';
import { setAdminGroups, setAdminOverride, clearAdminOverride, type AdminAccessOverride } from '@/app/actions/adminPermissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import type { PasswordKind } from '@/lib/password-format';
import type { OverrideEffect } from '@/lib/permission-engine';
import type { AdminWithLogin } from '@/lib/prisma-selects';
import type { AdminFormState } from './adminFormConfig';

export interface OverrideDraft {
  permissionKey: string;
  effect: OverrideEffect;
  reason: string;
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const lookup = new Set(b);
  return a.every((id) => lookup.has(id));
}

export interface AdminAccessDraft {
  selectedGroupIds: number[];
  originalGroupIds: number[];
  overrides: OverrideDraft[];
  originalOverrides: AdminAccessOverride[];
  accessReason: string;
}

export async function persistAdminAccessChanges(adminId: number, draft: AdminAccessDraft): Promise<string | null> {
  const groupChangePending = !sameIds(draft.selectedGroupIds, draft.originalGroupIds);
  const originalByKey = new Map(draft.originalOverrides.map((override) => [override.permissionKey, override]));
  const changedOverrides: OverrideDraft[] = [];
  for (const candidate of draft.overrides) {
    const original = originalByKey.get(candidate.permissionKey);
    if (!original || original.effect !== candidate.effect || (original.reason ?? '') !== candidate.reason) {
      changedOverrides.push(candidate);
    }
  }
  const removedOverrides = draft.originalOverrides.filter(
    (original) => !draft.overrides.some((candidate) => candidate.permissionKey === original.permissionKey),
  );

  if (!groupChangePending && changedOverrides.length === 0 && removedOverrides.length === 0) return null;
  if (!draft.accessReason.trim()) return 'A reason is required for access changes';
  for (const change of changedOverrides) {
    if (!change.reason.trim()) return `A reason is required for the override on "${change.permissionKey}"`;
  }

  if (groupChangePending) {
    const result = await setAdminGroups(adminId, draft.selectedGroupIds, draft.accessReason.trim());
    if (!result.success) return result.error;
  }
  for (const change of changedOverrides) {
    const result = await setAdminOverride(adminId, change.permissionKey, change.effect, change.reason.trim());
    if (!result.success) return result.error;
  }
  for (const removed of removedOverrides) {
    const result = await clearAdminOverride(adminId, removed.permissionKey);
    if (!result.success) return result.error;
  }
  return null;
}

export interface PersistAdminAccountParams {
  initialData: AdminWithLogin | null | undefined;
  formData: AdminFormState;
  passwordKind: PasswordKind;
  callerPermissionSet: ReadonlySet<string>;
}

export async function persistAdminAccount({
  initialData,
  formData,
  passwordKind,
  callerPermissionSet,
}: PersistAdminAccountParams): Promise<{ success: boolean; error?: string; adminId: number | null }> {
  if (initialData) {
    const allowed = stripDisallowedFields('admins', formData as unknown as Record<string, unknown>, callerPermissionSet);
    const updated = await updateAdmin(initialData.id, {
      name: allowed.name as string | undefined,
      passwordKind,
      ...(allowed.password ? { password: allowed.password as string } : {}),
    });
    return { success: updated.success, error: updated.error, adminId: initialData.id };
  }

  // Why: the per-field update keys model the UPDATE contract, so a create payload is built straight
  // from the validated form data — creation itself is gated by admin:create on the server.
  const created = await createAdmin({
    name: formData.name,
    username: formData.username,
    password: formData.password,
    passwordKind,
  });
  if (!created.success) return { success: false, error: created.error, adminId: null };

  const admins = await getAdmins();
  const located = admins.find((admin) => admin.username === formData.username.trim());
  if (!located) {
    return { success: false, error: 'Admin created but could not be located to assign access', adminId: null };
  }
  return { success: true, adminId: located.id };
}
