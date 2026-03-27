export interface SubmissionWithRelations {
  id: number;
  timestamp: Date | string;
  official: boolean;
  comment?: string | null;
  language?: string | null;
  tasks: {
    id: number;
    name: string;
    title?: string | null;
    active_dataset_id?: number | null;
  };
  participations: {
    id?: number;
    users: { username: string; id?: number };
    contests: { name: string; id?: number };
  };
  submission_results: Array<{
    score?: number | null;
    dataset_id?: number;
    compilation_outcome?: string | null;
    evaluation_outcome?: string | null;
    compilation_time?: number | null;
    compilation_memory?: number | null;
    compilation_text?: string | null;
    compilation_stdout?: string | null;
    compilation_stderr?: string | null;
    datasets?: Record<string, unknown>;
  }>;
  files?: Array<{ filename: string; digest: string }>;
  evaluations?: Array<Record<string, unknown>>;
}
