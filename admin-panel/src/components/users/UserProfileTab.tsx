'use client';

import { useMemo } from 'react';
import { revealUserPassword } from '@/app/actions/users';
import { SavedSecretReveal } from '@/components/core/SavedSecretReveal';
import { Card } from '@/components/core/Card';
import type { Dictionary } from '@/lib/dictionary';
import { hasEffectivePermission } from '@/lib/permission-engine';

export interface UserProfileTabProps {
  readonly userId: number;
  readonly copy: Dictionary['users'];
  readonly permissionKeys: readonly string[];
}

/**
 * The one thing about a profile that is not a value: the saved password, which is read on request
 * rather than rendered.
 *
 * Why the values are not here: the detail layout owns the fact strip, and the tab had drawn a
 * second card of its own labels beside it. What is left is the action the strip cannot carry - a
 * masked secret that only arrives when an operator with password:reveal asks for it.
 */
export function UserProfileTab({ userId, copy, permissionKeys }: UserProfileTabProps): React.JSX.Element {
  const fields = copy.profile;
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canReveal = hasEffectivePermission(effective, 'password:reveal');
  return (
    <Card className="p-4">
      <SavedSecretReveal label={fields.savedPassword} canReveal={canReveal} onReveal={() => revealUserPassword(userId)} />
    </Card>
  );
}
