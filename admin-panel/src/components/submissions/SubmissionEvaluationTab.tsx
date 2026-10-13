'use client';

import type { Dictionary } from '@/lib/dictionary';
import type { SubmissionEvaluationModel, SubmissionSummary } from '@/lib/evaluation-read-model-types';

import { SubmissionActionBar } from './SubmissionActionBar';
import { TestcaseDetailTable } from './TestcaseDetailTable';

export interface SubmissionEvaluationTabProps {
  readonly model: SubmissionEvaluationModel;
  readonly capabilities: SubmissionSummary['capabilities'];
  readonly navigation: Dictionary['navigation'];
}

export function SubmissionEvaluationTab({ model, capabilities, navigation }: SubmissionEvaluationTabProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <TestcaseDetailTable model={model} />
      <SubmissionActionBar
        submissionId={model.submissionId}
        capabilities={capabilities}
        entries={['lane']}
        navigation={navigation}
      />
    </div>
  );
}
