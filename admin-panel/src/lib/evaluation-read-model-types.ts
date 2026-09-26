export interface SubmissionSummary {
  id: number;
  timestamp: string;
  language: string | null;
  comment: string;
  official: boolean;
  user: { id: number; username: string } | null;
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
