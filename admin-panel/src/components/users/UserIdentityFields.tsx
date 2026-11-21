'use client';

import { RestrictedField } from '@/components/core/RestrictedField';
import { cn } from '@/lib/utils';
import type { FieldAccessTable } from '@/lib/field-permissions';
import type { UserFormState } from './userFormState';

interface UserIdentityFieldsProps {
  formData: UserFormState;
  updateForm: (updates: Partial<UserFormState>) => void;
  fieldAccess: FieldAccessTable<'users'>;
  inputClassName: string;
}

export function UserIdentityFields({
  formData,
  updateForm,
  fieldAccess,
  inputClassName,
}: UserIdentityFieldsProps): React.JSX.Element {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RestrictedField
          canRead={fieldAccess.first_name.canRead}
          canUpdate={fieldAccess.first_name.canUpdate}
          label="First Name"
          lockHint="Read-only — you lack user:update"
        >
          <input
            required
            type="text"
            value={formData.first_name}
            onChange={(e) => updateForm({ first_name: e.target.value })}
            className={cn(inputClassName, 'font-sans')}
            placeholder="John"
          />
        </RestrictedField>
        <RestrictedField
          canRead={fieldAccess.last_name.canRead}
          canUpdate={fieldAccess.last_name.canUpdate}
          label="Last Name"
          lockHint="Read-only — you lack user:update"
        >
          <input
            required
            type="text"
            value={formData.last_name}
            onChange={(e) => updateForm({ last_name: e.target.value })}
            className={cn(inputClassName, 'font-sans')}
            placeholder="Doe"
          />
        </RestrictedField>
      </div>
      <RestrictedField
        canRead={fieldAccess.username.canRead}
        canUpdate={fieldAccess.username.canUpdate}
        label="Username"
        lockHint="Read-only — you lack user:update"
      >
        <input
          required
          type="text"
          value={formData.username}
          onChange={(e) => updateForm({ username: e.target.value })}
          className={cn(inputClassName, 'font-mono')}
          placeholder="johndoe"
        />
      </RestrictedField>

      <RestrictedField
        canRead={fieldAccess.email.canRead}
        canUpdate={fieldAccess.email.canUpdate}
        label="Email (Optional)"
        lockHint="Read-only — you lack user:update"
      >
        <input
          type="email"
          value={formData.email}
          onChange={(e) => updateForm({ email: e.target.value })}
          className={cn(inputClassName, 'font-sans')}
          placeholder="john@example.com"
        />
      </RestrictedField>
    </>
  );
}
