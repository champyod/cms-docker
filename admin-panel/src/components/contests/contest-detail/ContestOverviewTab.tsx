'use client';

import { SaveButton } from '@/components/core/SaveButton';
import type { ContestData } from '@/lib/contests-repo';
import type { ContestOverviewData } from '@/lib/queries/contest-detail';
import { ContestStatusCard } from './ContestStatusCard';
import {
  toOverviewFormState,
  useContestSettingsState,
  type ContestSettingsFormState,
} from './useContestSettingsState';

export type ContestOverviewTabProps = { data: ContestOverviewData };

// Why: the overview owns only timing — sending the full form would clobber
// settings fields this reader never loads, so the payload is picked narrowly.
function buildOverviewPayload(form: ContestSettingsFormState): Partial<ContestData> {
  return {
    start: form.start,
    stop: form.stop,
    analysis_start: form.analysis_start,
    analysis_stop: form.analysis_stop,
  };
}

export function ContestOverviewTab({ data }: ContestOverviewTabProps): React.JSX.Element {
  const { formData, updateForm, saving, justSaved, handleSave } = useContestSettingsState(
    data.contest.id,
    toOverviewFormState(data.contest),
    buildOverviewPayload,
  );
  return (
    <div className="space-y-6">
      <ContestStatusCard
        contest={data.contest}
        formData={{ start: formData.start, stop: formData.stop, analysis_start: formData.analysis_start, analysis_stop: formData.analysis_stop }}
        onChange={(patch) => updateForm(patch)}
      />
      <div className="flex justify-end">
        <SaveButton saving={saving} justSaved={justSaved} idleLabel="Save Changes" disabled={saving} onClick={() => { void handleSave(); }} />
      </div>
    </div>
  );
}
