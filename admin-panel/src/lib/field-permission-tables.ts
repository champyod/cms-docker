import type { FieldPermissionDef } from '@/lib/field-permissions';

// Why a separate file: field-permissions.ts must stay under 250 lines.
// These tables merge into FIELD_PERMISSION_MAP there; importers keep one path.
export const EXTRA_FIELD_PERMISSION_MAP: Record<string, Record<string, FieldPermissionDef>> = {
  evaluations: {
    id: { read: 'evaluation:read' },
    submission_id: { read: 'evaluation:read' },
    dataset_id: { read: 'evaluation:read' },
    testcase_id: { read: 'evaluation:read' },
    outcome: { read: 'evaluation:read' },
    text: { read: 'evaluation:read' },
    execution_time: { read: 'evaluation:read' },
    execution_memory: { read: 'evaluation:read' },
  },
  executables: {
    id: { read: 'executable:read' },
    submission_id: { read: 'executable:read' },
    dataset_id: { read: 'executable:read' },
    filename: { read: 'executable:read' },
    digest: { read: 'executable:read' },
  },
  files: {
    id: { read: 'file:read' },
    submission_id: { read: 'file:read' },
    filename: { read: 'file:read' },
    digest: { read: 'file:read' },
  },
  submission_results: {
    submission_id: { read: 'submissionresult:read' },
    dataset_id: { read: 'submissionresult:read' },
    score: { read: 'submissionresult:read' },
    public_score: { read: 'submissionresult:read' },
    compilation_outcome: { read: 'submissionresult:read' },
    evaluation_outcome: { read: 'submissionresult:read' },
    compilation_text: { read: 'submissionresult:read' },
    compilation_stdout: { read: 'submissionresult:read' },
    compilation_stderr: { read: 'submissionresult:read' },
  },
  tokens: {
    id: { read: 'token:read' },
    submission_id: { read: 'token:read' },
    timestamp: { read: 'token:read' },
  },
  user_tests: {
    id: { read: 'usertest:read' },
    participation_id: { read: 'usertest:read' },
    task_id: { read: 'usertest:read' },
    language: { read: 'usertest:read' },
    input: { read: 'usertest:read' },
    timestamp: { read: 'usertest:read' },
  },
  permissions: {
    key: { read: 'permission:read' },
    module: { read: 'permission:read' },
    verb: { read: 'permission:read' },
    description: { read: 'permission:read' },
  },
  groups: {
    id: { read: 'group:read' },
    name: { read: 'group:read' },
    description: { read: 'group:read' },
  },
};
