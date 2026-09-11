'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, X, ShieldCheck } from 'lucide-react';
import { createAdmin, updateAdmin, revealAdminPassword, getAdmins } from '@/app/actions/admins';
import {
  getAdminAccess,
  setAdminGroups,
  setAdminOverride,
  clearAdminOverride,
  listGroupsWithPermissions,
  type GroupWithPermissions,
  type AdminAccessOverride,
} from '@/app/actions/adminPermissions';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Card } from '@/components/core/Card';
import { useToast } from '@/components/providers/ToastProvider';
import type { PasswordRevealState } from '@/components/core/PasswordFieldWithKind';
import type { PasswordKind } from '@/lib/password-format';
import { resolveEffectivePermissions, type OverrideEffect } from '@/lib/permission-engine';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import type { AdminWithLogin } from '@/lib/prisma-selects';

import {
  EMPTY_ADMIN_FORM,
  formFromAdmin,
  validateAdminForm,
  type AdminFormState,
} from './adminFormConfig';
import { AdminFormFields, AdminModalFooter } from './adminModalSections';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: AdminWithLogin | null;
}

interface OverrideDraft {
  permissionKey: string;
  effect: OverrideEffect;
  reason: string;
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const lookup = new Set(b);
  return a.every((id) => lookup.has(id));
}

export function AdminModal({ isOpen, onClose, onSuccess, initialData }: AdminModalProps) {
  const toast = useToast();
  const [formData, setFormData] = useState<AdminFormState>(EMPTY_ADMIN_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');
  const [reveal, setReveal] = useState<PasswordRevealState>({ state: 'none' });

  const [groups, setGroups] = useState<GroupWithPermissions[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [originalGroupIds, setOriginalGroupIds] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<OverrideDraft[]>([]);
  const [originalOverrides, setOriginalOverrides] = useState<AdminAccessOverride[]>([]);
  const [accessReason, setAccessReason] = useState('');
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    setFormData(initialData ? formFromAdmin(initialData) : EMPTY_ADMIN_FORM);
    setError('');
    setPasswordKind('bcrypt');
    setReveal({ state: 'none' });
    setGroups([]);
    setSelectedGroupIds([]);
    setOriginalGroupIds([]);
    setOverrides([]);
    setOriginalOverrides([]);
    setAccessReason('');
    setAccessError('');
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

          const revealResult = await revealAdminPassword(initialData.id);
          if (!cancelled && revealResult.success) {
            setReveal(
              revealResult.kind === 'plaintext'
                ? { state: 'plaintext', value: revealResult.value }
                : { state: 'bcrypt' },
            );
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
  }, [initialData, isOpen]);

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

  if (!isOpen) return null;

  const updateForm = (updates: Partial<AdminFormState>) => setFormData((current) => ({ ...current, ...updates }));

  const handleGroupToggle = (groupId: number, checked: boolean) => {
    setSelectedGroupIds((current) =>
      checked ? Array.from(new Set([...current, groupId])) : current.filter((id) => id !== groupId),
    );
  };

  const handleAddOverride = () => {
    const used = new Set(overrides.map((override) => override.permissionKey));
    const next = PERMISSION_REGISTRY.find((definition) => !used.has(definition.key));
    if (!next) return;
    setOverrides((current) => [...current, { permissionKey: next.key, effect: 'allow', reason: '' }]);
  };

  const handleOverrideKey = (index: number, permissionKey: string) => {
    setOverrides((current) =>
      current.map((override, position) => (position === index ? { ...override, permissionKey } : override)),
    );
  };

  const handleOverrideEffect = (index: number, effect: OverrideEffect) => {
    setOverrides((current) =>
      current.map((override, position) => (position === index ? { ...override, effect } : override)),
    );
  };

  const handleOverrideReason = (index: number, reason: string) => {
    setOverrides((current) =>
      current.map((override, position) => (position === index ? { ...override, reason } : override)),
    );
  };

  const handleRemoveOverride = (index: number) => {
    setOverrides((current) => current.filter((_, position) => position !== index));
  };

  const persistAccessChanges = async (adminId: number): Promise<string | null> => {
    const groupChangePending = !sameIds(selectedGroupIds, originalGroupIds);
    const originalByKey = new Map(originalOverrides.map((override) => [override.permissionKey, override]));
    const changedOverrides: OverrideDraft[] = [];
    for (const draft of overrides) {
      const original = originalByKey.get(draft.permissionKey);
      if (!original || original.effect !== draft.effect || (original.reason ?? '') !== draft.reason) {
        changedOverrides.push(draft);
      }
    }
    const removedOverrides = originalOverrides.filter(
      (original) => !overrides.some((draft) => draft.permissionKey === original.permissionKey),
    );

    if (!groupChangePending && changedOverrides.length === 0 && removedOverrides.length === 0) return null;
    if (!accessReason.trim()) return 'A reason is required for access changes';
    for (const change of changedOverrides) {
      if (!change.reason.trim()) return `A reason is required for the override on "${change.permissionKey}"`;
    }

    if (groupChangePending) {
      const result = await setAdminGroups(adminId, selectedGroupIds, accessReason.trim());
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
  };

  const persistAccount = async (): Promise<{ success: boolean; error?: string; adminId: number | null }> => {
    if (initialData) {
      const updated = await updateAdmin(initialData.id, {
        name: formData.name,
        passwordKind,
        ...(formData.password ? { password: formData.password } : {}),
      });
      return { success: updated.success, error: updated.error, adminId: initialData.id };
    }

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
  };

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
      const account = await persistAccount();
      if (!account.success || account.adminId === null) {
        setError(account.error || 'Operation failed');
        return;
      }

      const accessFailure = await persistAccessChanges(account.adminId);
      if (accessFailure) {
        // Why: the account row is already saved, so surface the access failure without discarding the save.
        toast.addToast({ type: 'error', title: 'Access update failed', message: accessFailure });
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
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdminFormFields
          formData={formData}
          isEdit={!!initialData}
          onChange={updateForm}
          passwordKind={passwordKind}
          onPasswordKind={setPasswordKind}
          reveal={{ ...reveal, onReveal: () => undefined }}
        />

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase">Groups</span>
            {loadingAccess && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
          {accessError && <p className="text-xs text-destructive">{accessError}</p>}
          <div className="space-y-2">
            {groups.map((group) => (
              <label
                key={group.id}
                className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg border border-border cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">{group.name}</span>
                    {group.is_seeded && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground">Seeded</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{group.description ?? 'No description'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
                    {group.permissionKeys.length}
                  </span>
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.id)}
                    onChange={(event) => handleGroupToggle(group.id, event.target.checked)}
                    className="w-5 h-5 rounded accent-primary"
                  />
                </div>
              </label>
            ))}
            {!loadingAccess && groups.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No groups are defined yet.</p>
            )}
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase">Per-person overrides</span>
            <Button variant="secondary" size="sm" onClick={handleAddOverride}>
              <Plus className="w-4 h-4" />
              Add override
            </Button>
          </div>
          {overrides.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              This admin has no overrides — access matches their groups exactly.
            </p>
          )}
          {overrides.map((draft, index) => (
            <div
              key={`${draft.permissionKey}-${index}`}
              className="space-y-2 p-3 bg-muted/50 rounded-lg border border-border"
            >
              <div className="flex items-center gap-2">
                <select
                  value={draft.permissionKey}
                  onChange={(event) => handleOverrideKey(index, event.target.value)}
                  className="flex-1 h-9 min-w-0 rounded-md border border-input bg-transparent px-2 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {PERMISSION_REGISTRY.map((definition) => (
                    <option key={definition.key} value={definition.key}>
                      {definition.key}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.effect}
                  onChange={(event) => handleOverrideEffect(index, event.target.value as OverrideEffect)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  tooltip="Remove override"
                  onClick={() => handleRemoveOverride(index)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Input
                value={draft.reason}
                onChange={(event) => handleOverrideReason(index, event.target.value)}
                placeholder="Reason (required)"
              />
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase">Effective access</span>
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-400">
              <ShieldCheck className="w-3 h-3" />
              {effectivePermissions.size} permissions
            </span>
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1">
            {[...effectivePermissions].sort().map((key) => (
              <span key={key} className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground font-mono">
                {key}
              </span>
            ))}
            {effectivePermissions.size === 0 && (
              <p className="text-xs text-muted-foreground italic">
                No effective permissions — this admin will be denied everything.
              </p>
            )}
          </div>
        </Card>

        <Input
          label="Reason for access changes"
          value={accessReason}
          onChange={(event) => setAccessReason(event.target.value)}
          placeholder="e.g., onboarding, role change"
        />

        <AdminModalFooter loading={loading} isEdit={!!initialData} onClose={onClose} />
      </form>
    </Dialog>
  );
}
