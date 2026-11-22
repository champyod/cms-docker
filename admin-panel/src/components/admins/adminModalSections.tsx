'use client';

import { cn } from '@/lib/utils';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import { type AdminFormState } from './adminFormConfig';

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
              ? "bg-indigo-500 text-foreground shadow-lg shadow-indigo-500/20"
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
              ? "bg-purple-600 text-foreground shadow-lg shadow-purple-500/20"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Committee
        </button>
      </div>
    </div>
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

