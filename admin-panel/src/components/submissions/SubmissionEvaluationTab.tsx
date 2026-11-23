'use client';

import type { Dictionary } from '@/lib/dictionary';

import type { SubmissionEvaluationModel } from '@/lib/evaluation-read-model-types';

import { TestcaseDetailTable } from './TestcaseDetailTable';

export interface SubmissionEvaluationTabProps {
  readonly model: SubmissionEvaluationModel;
  /** Gates a testcase's input and expected output; the table rows are not gated by it. */
  readonly canReadTestcase: boolean;
  /** common.notSet: a cell or block whose value the record does not hold. */
  readonly missing: string;
  /** The testcase table's own words. */
  readonly copy: Dictionary['submissions']['record']['testcases'];
}

export function SubmissionEvaluationTab({ model, canReadTestcase, missing, copy }: SubmissionEvaluationTabProps): React.JSX.Element {
  return <TestcaseDetailTable model={model} canReadTestcase={canReadTestcase} missing={missing} copy={copy} />;
}
