'use client';

import { useState, useEffect, useMemo } from 'react';

import { revealUserPassword } from '@/app/actions/users';
import { Dialog } from '@/components/core/Dialog';
import { ModalFooter } from '@/components/core/ModalFooter';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import { SavedSecretReveal } from '@/components/core/SavedSecretReveal';
import { RestrictedField } from '@/components/core/RestrictedField';
import { InlineAlert } from '@/components/core/InlineAlert';
import { toast } from 'sonner';
import { apiClient } from '@/lib/apiClient';
import { getFieldAccess, stripDisallowedFields } from '@/lib/field-permissions';
import type { Dictionary } from '@/lib/dictionary';
import { normalizeLanguageCode } from '@/lib/constants/languages';
import type { PasswordKind } from '@/lib/password-format';
import type { SafeUser } from '@/lib/prisma-selects';

import { EMPTY_USER_FORM, formFromUser, type UserFormState } from './userFormState';
import { UserIdentityFields } from './UserIdentityFields';
import { UserPreferredLanguagesField } from './UserPreferredLanguagesField';
import { UserContestFields } from './UserContestFields';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: SafeUser | null;
  contests?: Array<{ id: number; name: string }>;
  canReadContests: boolean;
  navigation: Dictionary['navigation'];
  onSuccess: () => void;
  permissionKeys: readonly string[];
}

export function UserModal({ isOpen, onClose, user, contests = [], canReadContests, navigation, onSuccess, permissionKeys }: UserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<UserFormState>(EMPTY_USER_FORM);
  const [passwordKind, setPasswordKind] = useState<PasswordKind>('bcrypt');

  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const fieldAccess = useMemo(() => getFieldAccess('users', effective), [effective]);

  useEffect(() => {
    setFormData(user ? formFromUser(user) : EMPTY_USER_FORM);
    setPasswordKind('bcrypt');
  }, [user, isOpen]);

  const updateForm = (updates: Partial<UserFormState>) => setFormData({ ...formData, ...updates });

  const [langDraft, setLangDraft] = useState<string>('');

  function normalizePreferred(items: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of items) {
      const code = normalizeLanguageCode(raw);
      if (!code) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      result.push(code);
    }
    return result;
  }

  function addPreferredLanguage(): void {
    const code = normalizeLanguageCode(langDraft);
    if (!code) return;
    const next = normalizePreferred([...formData.preferred_languages, code]);
    updateForm({ preferred_languages: next });
    setLangDraft('');
  }

  function removePreferredLanguage(code: string): void {
    updateForm({ preferred_languages: formData.preferred_languages.filter((item) => item !== code) });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const normalized = {
        ...formData,
        preferred_languages: normalizePreferred(formData.preferred_languages),
      };
      const allowed = stripDisallowedFields('users', normalized as unknown as Record<string, unknown>, effective);
      const payload: Record<string, unknown> = { ...allowed };
      if (payload.password === '') delete payload.password;
      if (!payload.password) delete payload.password;
      payload.passwordKind = passwordKind;

      const result = user
        ? await apiClient.put(`/api/users/${user.id}`, payload)
        : await apiClient.post('/api/users', {
            ...payload,
            contestId: formData.contestId ? Number(formData.contestId) : undefined,
            teamCode: formData.teamCode || undefined,
          });

      if (result.success) {
        toast.success(user ? 'User updated' : 'User created', {
          description: formData.password
            ? `${formData.username} saved — new password is active immediately.`
            : `${formData.username} saved.`,
        });
        onSuccess();
        onClose();
      } else {
        const msg = result.error || 'Operation failed';
        setError(msg);
        toast.error('Save failed', { description: msg });
      }
    } catch {
      setError('An unexpected error occurred');
      toast.error('Save failed', { description: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
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
      title={user ? 'Edit User' : 'Create New User'}
      description={navigation.people.users.label}
      className="sm:max-w-md"
    >
      {error && <InlineAlert tone="destructive" density="regular" className="mb-4 border-destructive/30">{error}</InlineAlert>}
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <UserIdentityFields
          formData={formData}
          updateForm={updateForm}
          fieldAccess={fieldAccess}
          inputClassName={inputClassName}
        />

        <RestrictedField
          canRead={fieldAccess.password.canRead}
          canUpdate={fieldAccess.password.canUpdate}
          label={user ? 'New Password (Optional)' : 'Password'}
          lockHint="Read-only — you lack user:update"
        >
          <PasswordFieldWithKind
            label=""
            value={formData.password}
            onChange={(password) => updateForm({ password })}
            required={!user}
            placeholder="••••••••"
            kind={passwordKind}
            onKind={setPasswordKind}
          />
          {user && (
            <SavedSecretReveal
              label="Saved password"
              canReveal={fieldAccess.password.canRead}
              onReveal={() => revealUserPassword(user.id)}
            />
          )}
        </RestrictedField>
        <RestrictedField
          canRead={fieldAccess.timezone.canRead}
          canUpdate={fieldAccess.timezone.canUpdate}
          label="Timezone"
          lockHint="Read-only — you lack user:update"
        >
          <input
            type="text"
            value={formData.timezone}
            onChange={(e) => updateForm({ timezone: e.target.value })}
            className={inputClassName}
            placeholder="Asia/Bangkok"
          />
        </RestrictedField>
        <UserPreferredLanguagesField
          access={fieldAccess.preferred_languages}
          languages={formData.preferred_languages}
          draft={langDraft}
          inputClassName={inputClassName}
          onDraftChange={setLangDraft}
          onAdd={addPreferredLanguage}
          onRemove={removePreferredLanguage}
        />
        {!user && canReadContests && (
          <UserContestFields
            contests={contests}
            contestId={formData.contestId}
            teamCode={formData.teamCode}
            inputClassName={inputClassName}
            onChange={updateForm}
          />
        )}
        <ModalFooter
          formId="user-form"
          className="pt-6"
          cancelLabel="Cancel"
          cancelVariant="negativeOutline"
          confirmLabel={user ? 'Save Changes' : 'Create User'}
          onCancel={cancel}
          confirmLoading={loading}
          confirmDisabled={loading}
        />
      </form>
    </Dialog>
  );
}
