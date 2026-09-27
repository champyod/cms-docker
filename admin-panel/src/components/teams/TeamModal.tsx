'use client';

import { useState, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { ModalFooter } from '@/components/core/ModalFooter';
import { Dialog } from '@/components/core/Dialog';
import { RestrictedField } from '@/components/core/RestrictedField';
import { InlineAlert } from '@/components/core/InlineAlert';
import type { Dictionary } from '@/lib/dictionary';
import { getFieldAccess, stripDisallowedFields } from '@/lib/field-permissions';

interface TeamData {
  id?: number;
  code: string | null;
  name: string | null;
}

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: TeamData | null;
  permissionKeys: readonly string[];
  navigation: Dictionary['navigation'];
}

export function TeamModal({ isOpen, onClose, onSuccess, initialData, permissionKeys, navigation }: TeamModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const fieldAccess = useMemo(() => getFieldAccess('teams', effective), [effective]);

  const sessionKey = `${isOpen}:${initialData?.id ?? 'new'}`;
  const [renderedSession, setRenderedSession] = useState(sessionKey);
  if (renderedSession !== sessionKey) {
    setRenderedSession(sessionKey);
    setFormData(initialData ? { code: initialData.code ?? '', name: initialData.name ?? '' } : { code: '', name: '' });
    setError('');
  }

  const runAction = useActionFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');

    const allowed = stripDisallowedFields('teams', formData as Record<string, unknown>, effective);

    const result = await runAction(
      {
        pending: initialData ? 'Updating team...' : 'Creating team...',
        success: initialData ? 'Team updated' : 'Team created',
        failure: 'Save failed',
        description: `${formData.name} saved successfully.`,
      },
      () =>
        initialData && initialData.id
          ? apiClient.put(`/api/teams/${initialData.id}`, allowed)
          : apiClient.post('/api/teams', allowed)
    );
    if (!result) {
      setLoading(false);
      return;
    }
    if (result.success) {
      onSuccess();
      onClose();
    } else {
      setError(result.error || 'Operation failed');
    }
    setLoading(false);
  };

  const inputClassName = 'w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors';

  // Why the guard: a submit already in flight cannot be recalled, so cancelling
  // through it would close the dialog over an unresolved save.
  const cancel = (): void => {
    if (!loading) onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={initialData ? 'Edit Team' : 'Add Team'}
      description={navigation.people.teams.label}
      className="sm:max-w-md"
    >
      <form id="team-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <InlineAlert tone="destructive" density="compact" className="border-destructive/30 text-sm">{error}</InlineAlert>}

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

        <ModalFooter
          formId="team-form"
          className="pt-4"
          cancelLabel="Cancel"
          cancelVariant="negativeOutline"
          confirmLabel={initialData ? 'Update Team' : 'Create Team'}
          onCancel={cancel}
          confirmLoading={loading}
          confirmDisabled={loading}
        />
      </form>
    </Dialog>
  );
}
