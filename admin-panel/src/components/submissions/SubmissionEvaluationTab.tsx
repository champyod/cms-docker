'use client';

import type { SubmissionEvaluationModel } from '@/lib/evaluation-read-model-types';

import { TestcaseDetailTable } from './TestcaseDetailTable';

export interface SubmissionEvaluationTabProps {
  readonly model: SubmissionEvaluationModel;
  /** Gates a testcase's input and expected output; the table rows are not gated by it. */
  readonly canReadTestcase: boolean;
}

export function SubmissionEvaluationTab({ model, canReadTestcase }: SubmissionEvaluationTabProps): React.JSX.Element {
  return <TestcaseDetailTable model={model} canReadTestcase={canReadTestcase} />;
}
