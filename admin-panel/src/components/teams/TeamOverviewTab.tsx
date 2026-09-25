'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { deleteTeam, updateTeam } from '@/app/actions/teams';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { RestrictedField } from '@/components/core/RestrictedField';
import { SaveButton } from '@/components/core/SaveButton';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useJustSavedFlag } from '@/hooks/useJustSavedFlag';
import type { Dictionary } from '@/lib/dictionary';
import { getFieldAccess, type FieldAccess } from '@/lib/field-permissions';
import { buildRoute } from '@/lib/navigation/routes';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { TeamSummary } from '@/lib/people-read-model-types';

export interface TeamOverviewTabProps {
  readonly team: TeamSummary;
  readonly permissionKeys: readonly string[];
  readonly navigation: Dictionary['navigation'];
  readonly locale: 'en' | 'th';
}

interface TeamFormData {
  readonly code: string;
  readonly name: string;
}

interface TeamFormFieldProps {
  readonly id: keyof TeamFormData;
  readonly label: string;
  readonly access: FieldAccess;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function TeamFormField({ id, label, access, value, onChange }: TeamFormFieldProps): React.JSX.Element {
  return (
    <RestrictedField canRead={access.canRead} canUpdate={access.canUpdate} label={label} lockHint="Read-only — you lack team:update">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-3 py-2 bg-background/60 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 transition-colors"
      />
    </RestrictedField>
  );
}

// Why: the editable fields and the two mutations share one permission set, so
// they live beside the form they drive instead of inside the render path.
function useTeamOverviewForm(team: TeamSummary, canUpdateTeam: boolean, refresh: () => void): {
  readonly formData: TeamFormData;
  readonly saving: boolean;
  readonly justSaved: boolean;
  readonly changeField: (id: keyof TeamFormData, value: string) => void;
  readonly save: () => Promise<void>;
} {
  const runAction = useActionFeedback();
  const { justSaved, flashSaved } = useJustSavedFlag();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<TeamFormData>({ code: team.code, name: team.name });

  const changeField = (id: keyof TeamFormData, value: string): void => {
    setFormData((previous) => ({ ...previous, [id]: value }));
  };

  const save = async (): Promise<void> => {
    if (!canUpdateTeam) return;
    setSaving(true);
    try {
      const result = await runAction(
        { pending: 'Saving team...', success: 'Team saved', failure: 'Save failed', description: `${team.name} updated successfully.` },
        () => updateTeam(team.id, formData),
      );
      if (result?.success) { flashSaved(); refresh(); }
    } finally {
      setSaving(false);
    }
  };

  return { formData, saving, justSaved, changeField, save };
}

function useTeamDeletion(team: TeamSummary, locale: 'en' | 'th', push: (href: string) => void): () => Promise<void> {
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();

  return async (): Promise<void> => {
    if (!(await confirm(destructiveConfirm('team')))) return;
    const result = await runAction(
      { pending: 'Deleting team...', success: 'Team deleted', failure: 'Delete failed' },
      () => deleteTeam(team.id),
    );
    if (result?.success) push(buildRoute(locale, 'people.teams'));
  };
}

export function TeamOverviewTab({ team, permissionKeys, navigation, locale }: TeamOverviewTabProps): React.JSX.Element {
  const router = useAppRouter();
  const effective = new Set(permissionKeys);
  const fieldAccess = getFieldAccess('teams', effective);
  const canUpdateTeam = hasEffectivePermission(effective, 'team:update');
  const canDeleteTeam = hasEffectivePermission(effective, 'team:delete');
  const { formData, saving, justSaved, changeField, save } = useTeamOverviewForm(team, canUpdateTeam, router.refresh);
  const removeTeam = useTeamDeletion(team, locale, router.push);
  return (
    <Card className="p-4 space-y-4">
      <h2 className="font-bold">{navigation.people['team-tabs'].overview.label}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TeamFormField id="code" label="Team Code" access={fieldAccess.code} value={formData.code} onChange={(value) => changeField('code', value)} />
        <TeamFormField id="name" label="Team Name" access={fieldAccess.name} value={formData.name} onChange={(value) => changeField('name', value)} />
      </div>
      <div className="flex items-center justify-end gap-3">
        {canDeleteTeam && (
          <Button variant="negativeOutline" icon={Trash2} iconOnly tooltip="Delete team" onClick={() => { void removeTeam(); }} />
        )}
        {canUpdateTeam && (
          <SaveButton saving={saving} justSaved={justSaved} idleLabel="Save Changes" disabled={saving} onClick={() => { void save(); }} />
        )}
      </div>
    </Card>
  );
}
