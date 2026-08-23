'use client';

import { useState, useEffect } from 'react';
import { X, Shield, Loader } from 'lucide-react';
import { createAdmin, updateAdmin } from '@/app/actions/admins';
import { cn } from '@/lib/utils';
import { PasswordFieldWithGenerator } from '@/components/core/PasswordFieldWithGenerator';
import { Portal } from '@/components/core/Portal';
import type { AdminWithLogin } from '@/lib/prisma-selects';

import {
  EMPTY_ADMIN_FORM,
  PERMISSION_CHECKBOXES,
  ROLE_PRESETS,
  formFromAdmin,
  validateAdminForm,
  type AdminFormState,
} from './adminFormConfig';

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
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Display Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., John Doe"
                className="w-full px-4 py-3 bg-black/80 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="e.g., johnd"
                disabled={!!initialData}
                className="w-full px-4 py-3 bg-black/80 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
              />
            </div>

            <PasswordFieldWithGenerator
              label={`Password ${initialData ? '(Leave empty to keep current)' : ''}`}
              value={formData.password}
              onChange={(password) => setFormData({ ...formData, password })}
              required={!initialData}
              placeholder="••••••••"
            />

            {/* ROLE */}
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Role</label>
              <div className="flex gap-2 p-1 bg-black/80 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ...ROLE_PRESETS.superadmin })}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all",
                    formData.permission_all
                      ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                      : "text-neutral-500 hover:text-white"
                  )}
                >
                  Superadmin
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ...ROLE_PRESETS.committee })}
                  className={cn(
                    "flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all",
                    (!formData.permission_all)
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
                      : "text-neutral-500 hover:text-white"
                  )}
                >
                  Committee
                </button>
              </div>
            </div>

            {/* PERMISSIONS */}
            <div className="space-y-3 pt-2">
              {!formData.permission_all ? (
                PERMISSION_CHECKBOXES.map(({ key, label, description }) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5">
                    <div>
                      <label className="text-sm text-neutral-300 font-medium">{label}</label>
                      <p className="text-xs text-neutral-500">{description}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData[key]}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
                      className="w-5 h-5 rounded accent-purple-500"
                    />
                  </div>
                ))
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
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader className="w-4 h-4 animate-spin" /> : null}
                {loading ? (initialData ? 'Updating...' : 'Creating...') : (initialData ? 'Update Admin' : 'Create Admin')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
