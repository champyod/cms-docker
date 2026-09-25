'use client';

import { useMemo } from 'react';
import { revealUserPassword } from '@/app/actions/users';
import { SavedSecretReveal } from '@/components/core/SavedSecretReveal';
import { Card } from '@/components/core/Card';
import type { Dictionary } from '@/lib/dictionary';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { UserProfile, UserSummary } from '@/lib/people-read-model-types';

export interface UserProfileTabProps {
  readonly profile: UserProfile;
  readonly summary: UserSummary;
  readonly navigation: Dictionary['navigation'];
  readonly permissionKeys: readonly string[];
}

function Field({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="text-xs font-bold text-muted-foreground uppercase mb-1">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

export function UserProfileTab({ profile, summary, navigation, permissionKeys }: UserProfileTabProps): React.JSX.Element {
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canReveal = hasEffectivePermission(effective, 'password:reveal');
  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h2 className="font-bold mb-4">{navigation.people['user-tabs'].profile.label}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Username" value={<span className="font-mono">{profile.username}</span>} />
          <Field label="Name" value={`${profile.firstName} ${profile.lastName}`} />
          <Field label="Email" value={profile.email ?? '—'} />
          <Field label="Timezone" value={profile.timezone ?? '—'} />
          <Field label="Languages" value={profile.preferredLanguages.length > 0 ? profile.preferredLanguages.join(', ') : '—'} />
          <Field label="Status" value={profile.status ?? '—'} />
          <Field label="Organization" value={profile.organization ?? '—'} />
          <Field label="Country" value={profile.country ?? '—'} />
          <Field label="Participations" value={summary.participationCount} />
          <Field label="Teams" value={summary.teamCodes.length > 0 ? summary.teamCodes.join(', ') : '—'} />
        </div>
      </Card>
      <Card className="p-4">
        <SavedSecretReveal label="Saved password" canReveal={canReveal} onReveal={() => revealUserPassword(summary.id)} />
      </Card>
    </div>
  );
}
