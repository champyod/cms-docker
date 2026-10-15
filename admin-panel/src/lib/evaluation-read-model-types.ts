export const SUBMISSION_JUDGING_PHASES = ['judging', 'compiling', 'compilation-failed', 'evaluating', 'scoring', 'done'] as const;

export type SubmissionJudgingPhase = (typeof SUBMISSION_JUDGING_PHASES)[number];

export interface SubmissionJudgingState {
  readonly phase: SubmissionJudgingPhase;
  readonly totalScore: number | null;
}

export interface SubmissionSummary {
  id: number;
  timestamp: string;
  language: string | null;
  comment: string;
  official: boolean;
  user: { id: number; username: string; firstName: string | null; lastName: string | null } | null;
  contest: { id: number; name: string } | null;
  task: { id: number; name: string; title: string } | null;
  capabilities: {
    canUpdate: boolean;
    canRecompute: boolean;
    canDownload: boolean;
    canMoveLane: boolean;
  };
}

export interface SubmissionResultsModel {
  submissionId: number;
  results: readonly {
    datasetId: number;
    compilationOutcome: string | null;
    evaluationOutcome: string | null;
    compilationTime: number | null;
    compilationMemoryBytes: number | null;
    score: number | null;
    publicScore: number | null;
    scoredAt: string | null;
  }[];
  files: readonly { id: number; filename: string; digest: string }[];
}

export interface SubmissionLogsModel {
  submissionId: number;
  compilationOutcome: string | null;
  compilationText: readonly string[];
  compilationStdout: string | null;
  compilationStderr: string | null;
}

export interface SubmissionEvaluationModel {
  submissionId: number;
  evaluations: readonly {
    id: number;
    datasetId: number;
    testcaseId: number;
    testcaseName: string | null;
    outcome: string | null;
    text: readonly string[];
    executionTime: number | null;
    executionMemory: string | null;
  }[];
}

interface SubmissionTestcaseRef {
  submissionId: number;
  testcaseId: number;
  testcaseName: string | null;
  /** Null while the evaluation service stores no candidate output for a submission. */
  output: string | null;
}

// Why a union: input and expected output are governed by `testcase:read`, so a
// reader without it receives a payload with no such fields at all — the bytes
// are never sent and there is nothing left to hide.
export type SubmissionTestcaseDetailModel =
  | (SubmissionTestcaseRef & {
      testcaseReadable: true;
      input: string | null;
      expectedOutput: string | null;
    })
  | (SubmissionTestcaseRef & { testcaseReadable: false });

interface SubmissionSourceRef {
  submissionId: number;
  /** Selects the highlighter grammar; null when the submission records no language. */
  language: string | null;
}

// Why a union: a submission's file row is bound to `file:read` by the files field
// map, so a reader without it receives a payload carrying no filename and no
// digest — there is no reference left from which to fetch the bytes.
export type SubmissionSourceModel =
  | (SubmissionSourceRef & { sourceReadable: true; filename: string; digest: string })
  | (SubmissionSourceRef & { sourceReadable: false });
