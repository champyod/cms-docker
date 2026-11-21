'use client';

import { Input } from '@/components/core/Input';
import { PasswordFieldWithKind } from '@/components/core/PasswordFieldWithKind';
import { SavedSecretReveal } from '@/components/core/SavedSecretReveal';
import { RestrictedField } from '@/components/core/RestrictedField';
import { revealAdminPassword } from '@/app/actions/admins';
import type { PasswordKind } from '@/lib/password-format';
import type { FieldAccessTable } from '@/lib/field-permissions';
import type { AdminWithLogin } from '@/lib/prisma-selects';
import type { AdminFormState } from './adminFormConfig';

interface AdminAccountFieldsProps {
  formData: AdminFormState;
  initialData: AdminWithLogin | null | undefined;
  canCreate: boolean;
  fieldAccess: FieldAccessTable<'admins'>;
  canRevealPassword: boolean;
  passwordKind: PasswordKind;
  updateForm: (updates: Partial<AdminFormState>) => void;
  onPasswordKind: (kind: PasswordKind) => void;
}

export function AdminAccountFields({
  formData,
  initialData,
  canCreate,
  fieldAccess,
  canRevealPassword,
  passwordKind,
  updateForm,
  onPasswordKind,
}: AdminAccountFieldsProps): React.JSX.Element {
  return (
    <>
      <RestrictedField
        canRead={initialData ? fieldAccess.name.canRead : canCreate}
        canUpdate={initialData ? fieldAccess.name.canUpdate : canCreate}
        label="Display Name"
        lockHint="Read-only — you lack admin:update"
      >
        <Input
          value={formData.name}
          onChange={(e) => updateForm({ name: e.target.value })}
          placeholder="e.g., John Doe"
        />
      </RestrictedField>

      <RestrictedField
        canRead={initialData ? fieldAccess.username.canRead : canCreate}
        canUpdate={initialData ? fieldAccess.username.canUpdate : canCreate}
        label="Username"
        lockHint="Immutable after creation"
      >
        <Input
          value={formData.username}
          onChange={(e) => updateForm({ username: e.target.value })}
          placeholder="e.g., johnd"
          disabled={!!initialData}
        />
      </RestrictedField>

      <RestrictedField
        canRead={initialData ? fieldAccess.password.canRead : canCreate}
        canUpdate={initialData ? fieldAccess.password.canUpdate : canCreate}
        label={`Password ${initialData ? '(Leave empty to keep current)' : ''}`}
        lockHint="Read-only — you lack admin:password:update"
      >
        <PasswordFieldWithKind
          label=""
          value={formData.password}
          onChange={(password) => updateForm({ password })}
          required={!initialData}
          placeholder="••••••••"
          kind={passwordKind}
          onKind={onPasswordKind}
        />
        {initialData && (
          <SavedSecretReveal
            label="Saved password"
            canReveal={canRevealPassword}
            onReveal={() => revealAdminPassword(initialData.id)}
          />
        )}
      </RestrictedField>
    </>
  );
}
