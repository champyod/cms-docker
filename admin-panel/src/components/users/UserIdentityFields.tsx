'use client';

import { Input } from '@/components/core/Input';
import { RestrictedField } from '@/components/core/RestrictedField';
import type { FieldAccessTable } from '@/lib/field-permissions';
import type { UserFormState } from './userFormState';

interface UserIdentityFieldsProps {
  formData: UserFormState;
  updateForm: (updates: Partial<UserFormState>) => void;
  fieldAccess: FieldAccessTable<'users'>;
}

export function UserIdentityFields({
  formData,
  updateForm,
  fieldAccess,
}: UserIdentityFieldsProps): React.JSX.Element {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RestrictedField
          canRead={fieldAccess.first_name.canRead}
          canUpdate={fieldAccess.first_name.canUpdate}
          label="First Name"
          lockHint="Read-only: you lack user:update"
        >
          <Input
            required
            type="text"
            aria-label="First Name"
            value={formData.first_name}
            onChange={(event) => updateForm({ first_name: event.target.value })}
            placeholder="John"
          />
        </RestrictedField>
        <RestrictedField
          canRead={fieldAccess.last_name.canRead}
          canUpdate={fieldAccess.last_name.canUpdate}
          label="Last Name"
          lockHint="Read-only: you lack user:update"
        >
          <Input
            required
            type="text"
            aria-label="Last Name"
            value={formData.last_name}
            onChange={(event) => updateForm({ last_name: event.target.value })}
            placeholder="Doe"
          />
        </RestrictedField>
      </div>
      <RestrictedField
        canRead={fieldAccess.username.canRead}
        canUpdate={fieldAccess.username.canUpdate}
        label="Username"
        lockHint="Read-only: you lack user:update"
      >
        <Input
          required
          type="text"
          aria-label="Username"
          value={formData.username}
          onChange={(event) => updateForm({ username: event.target.value })}
          className="font-mono"
          placeholder="johndoe"
        />
      </RestrictedField>

      <RestrictedField
        canRead={fieldAccess.email.canRead}
        canUpdate={fieldAccess.email.canUpdate}
        label="Email (Optional)"
        lockHint="Read-only: you lack user:update"
      >
        <Input
          type="email"
          aria-label="Email (Optional)"
          value={formData.email}
          onChange={(event) => updateForm({ email: event.target.value })}
          placeholder="john@example.com"
        />
      </RestrictedField>
    </>
  );
}
