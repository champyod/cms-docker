'use client';

import { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { createAdmin, updateAdmin, revealAdminPassword } from '@/app/actions/admins';
import { Dialog } from '@/components/core/Dialog';
import type { PasswordRevealState } from '@/components/core/PasswordFieldWithKind';
import type { PasswordKind } from '@/lib/password-format';
import type { AdminWithLogin } from '@/lib/prisma-selects';

import {
  EMPTY_ADMIN_FORM,
  ROLE_PRESETS,
  formFromAdmin,
  validateAdminForm,
  type AdminFormState,
} from './adminFormConfig';
import {
  AdminFormFields,
  AdminModalFooter,
  AdminPermissionCheckboxes,
  AdminRoleSelector,
} from './adminModalSections';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: AdminWithLogin | null;
}

export function AdminModal({ isOpen, onClose, onSuccess, initialData }: AdminModalProps) {
  const [formData, setFormData] = useState<AdminFormState>(EMPTY_ADMIN_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');
  const [reveal, setReveal] = useState<PasswordRevealState>({ state: 'none' });

  useEffect(() => {
    setFormData(initialData ? formFromAdmin(initialData) : EMPTY_ADMIN_FORM);
    setError('');
    setPasswordKind('bcrypt');
    setReveal({ state: 'none' });
    if (!initialData || !isOpen) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await revealAdminPassword(initialData.id);
        if (cancelled || !result.success) return;
        setReveal(
          result.kind === 'plaintext'
            ? { state: 'plaintext', value: result.value }
            : { state: 'bcrypt' }
        );
      } catch {
        if (!cancelled) setReveal({ state: 'none' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const updateForm = (updates: Partial<AdminFormState>) => setFormData({ ...formData, ...updates });

  const submitAdmin = async (): Promise<{ success: boolean; error?: string }> => {
    if (!initialData) {
      return createAdmin({ ...formData, passwordKind });
    }
    return updateAdmin(initialData.id, {
      name: formData.name,
      permission_all: formData.permission_all,
      permission_messaging: formData.permission_messaging,
      permission_tasks: formData.permission_tasks,
      permission_users: formData.permission_users,
      permission_contests: formData.permission_contests,
      passwordKind,
      ...(formData.password ? { password: formData.password } : {})
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateAdminForm(formData, !!initialData);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    const result = await submitAdmin();
    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error || 'Operation failed');
    }
    setLoading(false);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={initialData ? 'Edit Administrator' : 'Add Administrator'}
      className="max-w-md"
    >
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {/* FORM */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <AdminFormFields
          formData={formData}
          isEdit={!!initialData}
          onChange={updateForm}
          passwordKind={passwordKind}
          onPasswordKind={setPasswordKind}
          reveal={{ ...reveal, onReveal: () => undefined }}
        />

        {/* ROLE */}
        <AdminRoleSelector
          isSuperadmin={formData.permission_all}
          onSelectRole={(role) => updateForm(ROLE_PRESETS[role])}
        />

        {/* PERMISSIONS */}
        <div className="space-y-3 pt-2">
          {!formData.permission_all ? (
            <AdminPermissionCheckboxes formData={formData} onChange={updateForm} />
          ) : (
            <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-indigo-400">Full Access Granted</span>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Superadmins have full control over the system, including infrastructure, settings, and other administrators.
              </p>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <AdminModalFooter loading={loading} isEdit={!!initialData} onClose={onClose} />
      </form>
    </Dialog>
  );
}
