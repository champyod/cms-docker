'use client';

import { Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PasswordFieldWithKind, type RevealProps } from '@/components/core/PasswordFieldWithKind';
import type { PasswordKind } from '@/lib/password-format';
import { PERMISSION_CHECKBOXES, type AdminFormState } from './adminFormConfig';

export interface RoleSelectorProps {
  isSuperadmin: boolean;
  onSelectRole: (role: 'superadmin' | 'committee') => void;
}

export function AdminRoleSelector({ isSuperadmin, onSelectRole }: RoleSelectorProps) {
  return (
    <div>
      <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Role</label>
      <div className="flex gap-2 p-1 bg-black/80 rounded-lg border border-white/10">
        <button
          type="button"
          onClick={() => onSelectRole('superadmin')}
          className={cn(
            "flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all",
            isSuperadmin
              ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              : "text-neutral-500 hover:text-white"
          )}
        >
          Superadmin
        </button>
        <button
          type="button"
          onClick={() => onSelectRole('committee')}
          className={cn(
            "flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all",
            (!isSuperadmin)
              ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
              : "text-neutral-500 hover:text-white"
          )}
        >
          Committee
        </button>
      </div>
    </div>
  );
}

export interface PermissionCheckboxListProps {
  formData: AdminFormState;
  onChange: (updates: Partial<AdminFormState>) => void;
}

export function AdminPermissionCheckboxes({ formData, onChange }: PermissionCheckboxListProps) {
  return (
    <>
      {PERMISSION_CHECKBOXES.map(({ key, label, description }) => (
        <div key={key} className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5">
          <div>
            <label className="text-sm text-neutral-300 font-medium">{label}</label>
            <p className="text-xs text-neutral-500">{description}</p>
          </div>
          <input
            type="checkbox"
            checked={formData[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
            className="w-5 h-5 rounded accent-purple-500"
          />
        </div>
      ))}
    </>
  );
}

export interface ModalFooterProps {
  loading: boolean;
  isEdit: boolean;
  onClose: () => void;
}

export function AdminModalFooter({ loading, isEdit, onClose }: ModalFooterProps) {
  return (
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
        {loading ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Admin' : 'Create Admin')}
      </button>
    </div>
  );
}

export interface FormFieldsProps {
  formData: AdminFormState;
  isEdit: boolean;
  onChange: (updates: Partial<AdminFormState>) => void;
  passwordKind: PasswordKind;
  onPasswordKind: (kind: PasswordKind) => void;
  reveal?: RevealProps;
}

export function AdminFormFields({ formData, isEdit, onChange, passwordKind, onPasswordKind, reveal }: FormFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Display Name</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g., John Doe"
          className="w-full px-4 py-3 bg-black/80 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Username</label>
        <input
          type="text"
          value={formData.username}
          onChange={(e) => onChange({ username: e.target.value })}
          placeholder="e.g., johnd"
          disabled={isEdit}
          className="w-full px-4 py-3 bg-black/80 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
        />
      </div>

      <PasswordFieldWithKind
        label={`Password ${isEdit ? '(Leave empty to keep current)' : ''}`}
        value={formData.password}
        onChange={(password) => onChange({ password })}
        required={!isEdit}
        placeholder="••••••••"
        kind={passwordKind}
        onKind={onPasswordKind}
        reveal={reveal}
      />
    </>
  );
}
