'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import { Button } from '@/components/core/Button';
import { Dialog, DialogFooter } from '@/components/core/Dialog';
import { RestrictedField } from '@/components/core/RestrictedField';
import { getFieldAccess, stripDisallowedFields } from '@/lib/field-permissions';

interface TeamData {
  id?: number;
  code: string;
  name: string;
}

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TeamData | null;
  permissionKeys: readonly string[];
}

export function TeamModal({ isOpen, onClose, onSuccess, initialData, permissionKeys }: TeamModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const fieldAccess = useMemo(() => getFieldAccess('teams', effective), [effective]);

  useEffect(() => {
    if (initialData) {
      setFormData({ code: initialData.code, name: initialData.name });
    } else {
      setFormData({ code: '', name: '' });
    }
    setError('');
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    const allowed = stripDisallowedFields('teams', formData as Record<string, unknown>, effective);

    const result = (initialData && initialData.id)
      ? await apiClient.put(`/api/teams/${initialData.id}`, allowed)
      : await apiClient.post('/api/teams', allowed);

    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error || 'Operation failed');
    }
    setLoading(false);
  };

  const inputClassName = 'w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initialData ? 'Edit Team' : 'Add Team'}
      className="sm:max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        <RestrictedField
          canRead={fieldAccess.code.canRead}
          canUpdate={fieldAccess.code.canUpdate}
          label="Team Code"
          lockHint="Read-only — you lack team:update"
        >
          <input
            type="text"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            className={`${inputClassName} font-mono`}
            placeholder="e.g. THA-01"
            autoFocus
          />
        </RestrictedField>
        <RestrictedField
          canRead={fieldAccess.name.canRead}
          canUpdate={fieldAccess.name.canUpdate}
          label="Team Name"
          lockHint="Read-only — you lack team:update"
        >
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputClassName}
            placeholder="e.g. Thailand Team 1"
          />
        </RestrictedField>

        <DialogFooter className="pt-4">
          <Button type="button" variant="negativeOutline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="positive" loading={loading} disabled={loading}>
            {initialData ? 'Update Team' : 'Create Team'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
