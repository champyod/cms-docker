'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  getAdminAccess,
  listGroupsWithPermissions,
  type GroupWithPermissions,
  type AdminAccessOverride,
} from '@/app/actions/adminPermissions';
import { Dialog } from '@/components/core/Dialog';
import { InlineAlert } from '@/components/core/InlineAlert';
import { toast } from 'sonner';
import type { PasswordKind } from '@/lib/password-format';
import { ACTION_PERMISSIONS, hasEffectivePermission, resolveEffectivePermissions } from '@/lib/permission-engine';
import type { AdminWithLogin } from '@/lib/prisma-selects';
import { getFieldAccess } from '@/lib/field-permissions';

import {
  EMPTY_ADMIN_FORM,
  formFromAdmin,
  validateAdminForm,
  type AdminFormState,
} from './adminFormConfig';
import { AdminModalFooter } from './adminModalSections';
import { AdminAccountFields } from './AdminAccountFields';
import { AdminAccessEditor } from './AdminAccessEditor';
import {
  persistAdminAccessChanges,
  persistAdminAccount,
  type OverrideDraft,
} from './adminModalPersistence';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: AdminWithLogin | null;
  callerPermissions: string[];
  canRevealPassword: boolean;
}

export function AdminModal({ isOpen, onClose, onSuccess, initialData, callerPermissions, canRevealPassword }: AdminModalProps) {
  const [formData, setFormData] = useState<AdminFormState>(EMPTY_ADMIN_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');

  const [groups, setGroups] = useState<GroupWithPermissions[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [originalGroupIds, setOriginalGroupIds] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<OverrideDraft[]>([]);
  const [originalOverrides, setOriginalOverrides] = useState<AdminAccessOverride[]>([]);
  const [accessReason, setAccessReason] = useState('');
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState('');

  const sessionKey = `${isOpen}:${initialData?.id ?? 'new'}`;
  const [renderedSession, setRenderedSession] = useState(sessionKey);
  if (renderedSession !== sessionKey) {
    setRenderedSession(sessionKey);
    setFormData(initialData ? formFromAdmin(initialData) : EMPTY_ADMIN_FORM);
    setError('');
    setPasswordKind('bcrypt');
    setGroups([]);
    setSelectedGroupIds([]);
    setOriginalGroupIds([]);
    setOverrides([]);
    setOriginalOverrides([]);
    setAccessReason('');
    setAccessError('');
  }

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    void (async () => {
      setLoadingAccess(true);
      try {
        const groupsResult = await listGroupsWithPermissions();
        if (cancelled) return;
        if (groupsResult.success) {
          setGroups(groupsResult.data);
        } else {
          setAccessError(groupsResult.error);
        }

        if (initialData) {
          const accessResult = await getAdminAccess(initialData.id);
          if (cancelled) return;
          if (accessResult.success) {
            const groupIds = accessResult.data.groups.map((group) => group.id);
            setSelectedGroupIds(groupIds);
            setOriginalGroupIds(groupIds);
            setOverrides(
              accessResult.data.overrides.map((override) => ({
                permissionKey: override.permissionKey,
                effect: override.effect,
                reason: override.reason ?? '',
              })),
            );
            setOriginalOverrides(accessResult.data.overrides);
          } else {
            setAccessError(accessResult.error);
          }
        }
      } catch (loadFailure) {
        if (!cancelled) {
          setAccessError(loadFailure instanceof Error ? loadFailure.message : 'Unable to load access data');
        }
      } finally {
        if (!cancelled) setLoadingAccess(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRevealPassword, initialData, isOpen]);

  // Why: the effective-access preview is computed on the client from the group permission keys and
  // override drafts so it updates instantly while editing, mirroring resolveEffectivePermissions (deny wins).
  const groupPermissionKeys = useMemo(() => {
    const keys: string[] = [];
    for (const groupId of selectedGroupIds) {
      const group = groups.find((candidate) => candidate.id === groupId);
      if (group) keys.push(...group.permissionKeys);
    }
    return keys;
  }, [groups, selectedGroupIds]);

  const effectivePermissions = useMemo(
    () =>
      resolveEffectivePermissions(
        groupPermissionKeys,
        overrides.map((override) => ({ permissionKey: override.permissionKey, effect: override.effect })),
      ),
    [groupPermissionKeys, overrides],
  );

  // Why: what this caller may edit is decided by the caller's own keys; the target's resolved set
  // above only feeds the "Effective access" preview, so editing a powerful admin cannot unlock fields.
  const callerPermissionSet = useMemo(() => new Set(callerPermissions), [callerPermissions]);

  const fieldAccess = useMemo(
    () => getFieldAccess('admins', callerPermissionSet),
    [callerPermissionSet],
  );

  // Why: creating an admin is gated by admin:create on the server, so a create form is editable
  // whenever the caller holds that key; the per-field update keys only govern editing an existing row.
  const canCreate = useMemo(
    () => hasEffectivePermission(callerPermissionSet, ACTION_PERMISSIONS.createAdmin),
    [callerPermissionSet],
  );

  if (!isOpen) return null;

  const updateForm = (updates: Partial<AdminFormState>) => setFormData((current) => ({ ...current, ...updates }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateAdminForm(formData, !!initialData);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const account = await persistAdminAccount({ initialData, formData, passwordKind, callerPermissionSet });
      if (!account.success || account.adminId === null) {
        setError(account.error || 'Operation failed');
        return;
      }

      const accessFailure = await persistAdminAccessChanges(account.adminId, {
        selectedGroupIds,
        originalGroupIds,
        overrides,
        originalOverrides,
        accessReason,
      });
      if (accessFailure) {
        // Why: the account row is already saved, so surface the access failure without discarding the save.
        toast.error('Access update failed', { description: accessFailure });
        return;
      }

      onSuccess();
      onClose();
    } catch (submitFailure) {
      setError(submitFailure instanceof Error ? submitFailure.message : 'Operation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={initialData ? 'Edit Administrator' : 'Add Administrator'}
      className="max-w-md max-h-[85vh] overflow-y-auto"
    >
      {error && <InlineAlert tone="destructive" density="regular">{error}</InlineAlert>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdminAccountFields
          formData={formData}
          initialData={initialData}
          canCreate={canCreate}
          fieldAccess={fieldAccess}
          canRevealPassword={canRevealPassword}
          passwordKind={passwordKind}
          updateForm={updateForm}
          onPasswordKind={setPasswordKind}
        />

        <AdminAccessEditor
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          overrides={overrides}
          loadingAccess={loadingAccess}
          accessError={accessError}
          accessReason={accessReason}
          effectivePermissions={effectivePermissions}
          onSelectedGroupIdsChange={setSelectedGroupIds}
          onOverridesChange={setOverrides}
          onAccessReasonChange={setAccessReason}
        />

        <AdminModalFooter loading={loading} isEdit={!!initialData} onClose={onClose} />
      </form>
    </Dialog>
  );
}
