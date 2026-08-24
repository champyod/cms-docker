'use client';

import { cn } from '@/lib/utils';
import { PasswordFieldWithKind, type RevealProps } from '@/components/core/PasswordFieldWithKind';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import type { PasswordKind } from '@/lib/password-format';
import { PERMISSION_CHECKBOXES, type AdminFormState } from './adminFormConfig';

export interface RoleSelectorProps {
  isSuperadmin: boolean;
  onSelectRole: (role: 'superadmin' | 'committee') => void;
}

export function AdminRoleSelector({ isSuperadmin, onSelectRole }: RoleSelectorProps) {
  return (
    <div>
      <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Role</label>
      <div className="flex gap-2 p-1 bg-muted rounded-lg border border-border">
        <button
          type="button"
          onClick={() => onSelectRole('superadmin')}
          className={cn(
            "flex-1 py-1.5 px-3 rounded text-xs font-medium transition-all",
            isSuperadmin
              ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              : "text-muted-foreground hover:text-foreground"
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
              : "text-muted-foreground hover:text-foreground"
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
        <div key={key} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border">
          <div>
            <label className="text-sm text-foreground font-medium">{label}</label>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <input
            type="checkbox"
            checked={formData[key]}
            onChange={(e) => onChange({ [key]: e.target.checked })}
            className="w-5 h-5 rounded accent-primary"
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
      <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>
        Cancel
      </Button>
      <Button type="submit" variant="positive" className="flex-1" loading={loading}>
        {loading ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Admin' : 'Create Admin')}
      </Button>
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
      <Input
        label="Display Name"
        value={formData.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="e.g., John Doe"
      />

      <Input
        label="Username"
        value={formData.username}
        onChange={(e) => onChange({ username: e.target.value })}
        placeholder="e.g., johnd"
        disabled={isEdit}
      />

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
