'use client';

import { useState } from 'react';
import { SaveButton } from '@/components/core/SaveButton';
import type { ContestData } from '@/lib/contests-repo';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type { ContestSettingsData } from '@/lib/queries/contest-detail';
import { ContestSettingsSection } from './ContestSettingsSection';
import {
  toSettingsFormState,
  useContestSettingsState,
  type ContestSettingsFormState,
} from './useContestSettingsState';

export type ContestSettingsTabProps = { data: ContestSettingsData };

// Why: the settings tab owns every field its reader loads, so unlike the
// overview tab the payload carries the whole form.
function buildSettingsPayload(form: ContestSettingsFormState): Partial<ContestData> {
  return {
    name: form.name,
    description: form.description,
    timezone: form.timezone,
    allow_questions: form.allow_questions,
    allow_user_tests: form.allow_user_tests,
    submissions_download_allowed: form.submissions_download_allowed,
    allow_password_authentication: form.allow_password_authentication,
    allow_registration: form.allow_registration,
    analysis_enabled: form.analysis_enabled,
    token_mode: form.token_mode,
    score_precision: form.score_precision,
    start: form.start,
    stop: form.stop,
    analysis_start: form.analysis_start,
    analysis_stop: form.analysis_stop,
  };
}

export function ContestSettingsTab({ data }: ContestSettingsTabProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  // Why: the settings reader carries only contest:read — without
  // contest:update the form locks and the save affordance never appears.
  const canEdit = hasEffectivePermission(new Set(data.permissionKeys), 'contest:update');
  const { formData, updateForm, saving, justSaved, handleSave } = useContestSettingsState(
    data.contestId,
    toSettingsFormState(data.fields),
    buildSettingsPayload,
  );
  return (
    <div className="space-y-6">
      <ContestSettingsSection
        formData={formData}
        expanded={expanded}
        canEdit={canEdit}
        onToggle={() => setExpanded((previous) => !previous)}
        onChange={(patch) => updateForm(patch)}
      />
      {canEdit && (
        <div className="flex justify-end">
          <SaveButton saving={saving} justSaved={justSaved} idleLabel="Save Changes" disabled={saving} onClick={() => { void handleSave(); }} />
        </div>
      )}
    </div>
  );
}
