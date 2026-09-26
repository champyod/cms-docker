import { filterReadableFields } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import type {
  SubmissionEvaluationModel,
  SubmissionLogsModel,
  SubmissionResultsModel,
  SubmissionSummary,
} from '@/lib/evaluation-read-model-types';

// Why: ISO strings serialize safely through server action boundaries (Prisma returns Dates).
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Why: the execution memory column is BigInt and only a string crosses the
// boundary losslessly.
export function toMemoryString(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Why bytes as a number: the Results tab converts to megabytes, and a figure past
// the safe integer range is reported as unknown rather than silently rounded.
export function toByteCount(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

// Why: outcome columns are enums — stringify so tabs render text without enum imports.
export function toOutcome(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Why a stripped field becomes null: filterReadableFields drops a field the caller
// may not read, so falling back to the raw column would put back exactly what the
// field permission removed. Identity columns are the exception because each one is
// bound to a key its reader already required, which the projection cannot drop.
export function readUser(
  relation: { id: number; username: string } | null,
  permissions: ReadonlySet<string>,
): SubmissionSummary['user'] {
  if (!relation || !hasEffectivePermission(permissions, 'user:read')) return null;
  const visible = filterReadableFields('users', { id: relation.id, username: relation.username }, permissions);
  if (visible.id === undefined || visible.username === undefined) return null;
  return { id: visible.id, username: visible.username };
}

export function readContest(
  relation: { id: number; name: string } | null,
  permissions: ReadonlySet<string>,
): SubmissionSummary['contest'] {
  if (!relation || !hasEffectivePermission(permissions, 'contest:read')) return null;
  const visible = filterReadableFields('contests', { id: relation.id, name: relation.name }, permissions);
  if (visible.id === undefined || visible.name === undefined) return null;
  return { id: visible.id, name: visible.name };
}

export function readTask(
  relation: { id: number; name: string; title: string } | null,
  permissions: ReadonlySet<string>,
): SubmissionSummary['task'] {
  if (!relation || !hasEffectivePermission(permissions, 'task:read')) return null;
  const visible = filterReadableFields('tasks', { id: relation.id, name: relation.name, title: relation.title }, permissions);
  if (visible.id === undefined || visible.name === undefined || visible.title === undefined) return null;
  return { id: visible.id, name: visible.name, title: visible.title };
}

export function readSubmissionCapabilities(permissions: ReadonlySet<string>): SubmissionSummary['capabilities'] {
  return {
    canUpdate: hasEffectivePermission(permissions, 'submission:update'),
    canRecompute: hasEffectivePermission(permissions, 'submission:recompute'),
    canDownload: hasEffectivePermission(permissions, 'submission:download'),
    canMoveLane: hasEffectivePermission(permissions, 'evaluation:lane_move'),
  };
}

export interface SubmissionResultRow {
  readonly dataset_id: number;
  readonly compilation_outcome: unknown;
  readonly evaluation_outcome: unknown;
  readonly compilation_time: number | null;
  readonly compilation_memory: bigint | number | null;
  readonly score: number | null;
  readonly public_score: number | null;
  readonly scored_at: Date | string | null;
}

export interface SubmissionLogRow {
  readonly compilation_outcome: unknown;
  readonly compilation_text: readonly string[];
  readonly compilation_stdout: string | null;
  readonly compilation_stderr: string | null;
}

export interface SubmissionFileRow {
  readonly id: number;
  readonly filename: string;
  readonly digest: string;
}

export interface SubmissionEvaluationRow {
  readonly id: number;
  readonly dataset_id: number;
  readonly testcase_id: number;
  readonly outcome: unknown;
  readonly text: readonly string[];
  readonly execution_time: number | null;
  readonly execution_memory: bigint | number | null;
  readonly codename: string | null;
}

/**
 * Projects one submission_results row into the Results tab model.
 *
 * Exported so the field filter is provable without a database: a caller without
 * `submissionresult:read` gets null for every governed column instead of the
 * stored value.
 */
export function toSubmissionResultRow(
  row: SubmissionResultRow,
  permissions: ReadonlySet<string>,
): SubmissionResultsModel['results'][number] {
  const visible = filterReadableFields('submission_results', {
    compilation_outcome: row.compilation_outcome,
    evaluation_outcome: row.evaluation_outcome,
    compilation_time: row.compilation_time,
    compilation_memory: row.compilation_memory,
    score: row.score,
    public_score: row.public_score,
    scored_at: row.scored_at,
  }, permissions);
  return {
    datasetId: row.dataset_id,
    compilationOutcome: toOutcome(visible.compilation_outcome ?? null),
    evaluationOutcome: toOutcome(visible.evaluation_outcome ?? null),
    compilationTime: visible.compilation_time ?? null,
    compilationMemoryBytes: toByteCount(visible.compilation_memory ?? null),
    score: visible.score ?? null,
    publicScore: visible.public_score ?? null,
    scoredAt: toIso(visible.scored_at ?? null),
  };
}

export function toSubmissionLogRow(
  row: SubmissionLogRow,
  permissions: ReadonlySet<string>,
): Omit<SubmissionLogsModel, 'submissionId'> {
  const visible = filterReadableFields('submission_results', {
    compilation_outcome: row.compilation_outcome,
    compilation_text: row.compilation_text,
    compilation_stdout: row.compilation_stdout,
    compilation_stderr: row.compilation_stderr,
  }, permissions);
  return {
    compilationOutcome: toOutcome(visible.compilation_outcome ?? null),
    compilationText: visible.compilation_text ?? [],
    compilationStdout: visible.compilation_stdout ?? null,
    compilationStderr: visible.compilation_stderr ?? null,
  };
}

export function toSubmissionFileRow(
  row: SubmissionFileRow,
  permissions: ReadonlySet<string>,
): SubmissionResultsModel['files'][number] {
  const visible = filterReadableFields('files', { filename: row.filename, digest: row.digest }, permissions);
  return { id: row.id, filename: visible.filename ?? '', digest: visible.digest ?? '' };
}

export function toSubmissionEvaluationRow(
  row: SubmissionEvaluationRow,
  permissions: ReadonlySet<string>,
): SubmissionEvaluationModel['evaluations'][number] {
  const visible = filterReadableFields('evaluations', {
    outcome: row.outcome,
    text: row.text,
    execution_time: row.execution_time,
    execution_memory: row.execution_memory,
  }, permissions);
  return {
    id: row.id,
    datasetId: row.dataset_id,
    testcaseId: row.testcase_id,
    testcaseName: row.codename,
    outcome: toOutcome(visible.outcome ?? null),
    text: visible.text ?? [],
    executionTime: visible.execution_time ?? null,
    executionMemory: toMemoryString(visible.execution_memory ?? null),
  };
}
