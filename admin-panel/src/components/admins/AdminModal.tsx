'use client';

import { useState, useEffect } from 'react';
import { X, Shield } from 'lucide-react';
import { createAdmin, updateAdmin } from '@/app/actions/admins';
import { Portal } from '@/components/core/Portal';
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

  useEffect(() => {
    setFormData(initialData ? formFromAdmin(initialData) : EMPTY_ADMIN_FORM);
    setError('');
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const updateForm = (updates: Partial<AdminFormState>) => setFormData({ ...formData, ...updates });

  const submitAdmin = async (): Promise<{ success: boolean; error?: string }> => {
    if (!initialData) {
      return createAdmin(formData);
    }
    return updateAdmin(initialData.id, {
      name: formData.name,
      permission_all: formData.permission_all,
      permission_messaging: formData.permission_messaging,
      permission_tasks: formData.permission_tasks,
      permission_users: formData.permission_users,
      permission_contests: formData.permission_contests,
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
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

        <div className="relative z-10 w-full max-w-md bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-bold text-white">{initialData ? 'Edit Administrator' : 'Add Administrator'}</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          {error && (
            <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* FORM */}
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <AdminFormFields formData={formData} isEdit={!!initialData} onChange={updateForm} />

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
                  <p className="text-xs text-neutral-400 italic">
                    Superadmins have full control over the system, including infrastructure, settings, and other administrators.
                  </p>
                </div>
              )}
            </div>

            {/* FOOTER */}
            <AdminModalFooter loading={loading} isEdit={!!initialData} onClose={onClose} />
          </form>
        </div>
      </div>
    </Portal>
  );
}
