import { filterReadableFields } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';
import type { SubmissionEvaluationModel, SubmissionLogsModel, SubmissionResultsModel, SubmissionSummary } from '@/lib/evaluation-read-model-types';

// Why: ISO strings serialize safely through server action boundaries (Prisma returns Dates).
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Why: memory columns are BigInt — clients receive plain strings, never BigInt values.
function toMemoryString(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Why: outcome columns are enums — stringify so tabs render text without enum imports.
function toOutcome(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function getSubmissionSummary(submissionId: number): Promise<SubmissionSummary | null> {
  const permissions = await requirePermission('submission:read');
  const row = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true, timestamp: true, language: true, comment: true, official: true, participations: { select: { users: { select: { id: true, username: true } }, contests: { select: { id: true, name: true } } } }, tasks: { select: { id: true, name: true, title: true } } } });
  if (!row) return null;
  const visible = filterReadableFields('submissions', { id: row.id, timestamp: row.timestamp, language: row.language, comment: row.comment, official: row.official }, permissions);
  // Why: relation names need their own read projection — without it the summary carries null.
  const userRelation = hasEffectivePermission(permissions, 'user:read') ? row.participations?.users ?? null : null;
  const contestRelation = hasEffectivePermission(permissions, 'contest:read') ? row.participations?.contests ?? null : null;
  const taskRelation = hasEffectivePermission(permissions, 'task:read') ? row.tasks ?? null : null;
  const user = userRelation ? filterReadableFields('users', { id: userRelation.id, username: userRelation.username }, permissions) : null;
  const contest = contestRelation ? filterReadableFields('contests', { id: contestRelation.id, name: contestRelation.name }, permissions) : null;
  const task = taskRelation ? filterReadableFields('tasks', { id: taskRelation.id, name: taskRelation.name, title: taskRelation.title }, permissions) : null;
  return {
    id: visible.id ?? row.id, timestamp: toIso(row.timestamp) ?? '', language: visible.language ?? row.language, comment: visible.comment ?? row.comment, official: visible.official ?? row.official,
    user: userRelation ? { id: user?.id ?? userRelation.id, username: user?.username ?? userRelation.username } : null,
    contest: contestRelation ? { id: contest?.id ?? contestRelation.id, name: contest?.name ?? contestRelation.name } : null,
    task: taskRelation ? { id: task?.id ?? taskRelation.id, name: task?.name ?? taskRelation.name, title: task?.title ?? taskRelation.title } : null,
    capabilities: { canUpdate: hasEffectivePermission(permissions, 'submission:update'), canRecompute: hasEffectivePermission(permissions, 'submission:recompute'), canDownload: hasEffectivePermission(permissions, 'submission:download'), canAssignLane: hasEffectivePermission(permissions, 'evaluation:lane_assign'), canMoveLane: hasEffectivePermission(permissions, 'evaluation:lane_move') },
  };
}

export async function getSubmissionResults(submissionId: number): Promise<SubmissionResultsModel | null> {
  const permissions = new Set<string>([...await requirePermission('submission:read'), ...await requirePermission('submissionresult:read'), ...await requirePermission('file:read')]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const [results, files] = await Promise.all([
    prisma.submission_results.findMany({ where: { submission_id: submissionId }, orderBy: { dataset_id: 'asc' } }),
    prisma.files.findMany({ where: { submission_id: submissionId }, orderBy: { filename: 'asc' } }),
  ]);
  return {
    submissionId,
    results: results.map((entry) => {
      const visible = filterReadableFields('submission_results', { dataset_id: entry.dataset_id, compilation_outcome: entry.compilation_outcome, evaluation_outcome: entry.evaluation_outcome, compilation_time: entry.compilation_time, score: entry.score, public_score: entry.public_score, scored_at: entry.scored_at }, permissions);
      return { datasetId: visible.dataset_id ?? entry.dataset_id, compilationOutcome: toOutcome(visible.compilation_outcome ?? entry.compilation_outcome), evaluationOutcome: toOutcome(visible.evaluation_outcome ?? entry.evaluation_outcome), compilationTime: visible.compilation_time ?? entry.compilation_time, score: visible.score ?? entry.score, publicScore: visible.public_score ?? entry.public_score, scoredAt: toIso(entry.scored_at) };
    }),
    files: files.map((file) => {
      const visible = filterReadableFields('files', { id: file.id, filename: file.filename, digest: file.digest }, permissions);
      return { id: visible.id ?? file.id, filename: visible.filename ?? file.filename, digest: visible.digest ?? file.digest };
    }),
  };
}

export async function getSubmissionLogs(submissionId: number): Promise<SubmissionLogsModel | null> {
  const permissions = new Set<string>([...await requirePermission('submission:read'), ...await requirePermission('submissionresult:read')]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const rows = await prisma.submission_results.findMany({ where: { submission_id: submissionId }, orderBy: { dataset_id: 'asc' } });
  const entry = rows[0] ?? null;
  if (!entry) return { submissionId, compilationOutcome: null, compilationText: [], compilationStdout: null, compilationStderr: null };
  const visible = filterReadableFields('submission_results', { compilation_outcome: entry.compilation_outcome, compilation_text: entry.compilation_text, compilation_stdout: entry.compilation_stdout, compilation_stderr: entry.compilation_stderr }, permissions);
  return { submissionId, compilationOutcome: toOutcome(visible.compilation_outcome ?? entry.compilation_outcome), compilationText: [...(visible.compilation_text ?? entry.compilation_text)], compilationStdout: visible.compilation_stdout ?? entry.compilation_stdout, compilationStderr: visible.compilation_stderr ?? entry.compilation_stderr };
}

export async function getSubmissionEvaluation(submissionId: number): Promise<SubmissionEvaluationModel | null> {
  const permissions = new Set<string>([...await requirePermission('submission:read'), ...await requirePermission('evaluation:read')]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const rows = await prisma.evaluations.findMany({ where: { submission_id: submissionId }, orderBy: { testcase_id: 'asc' }, include: { testcases: { select: { codename: true } } } });
  return {
    submissionId,
    evaluations: rows.map((entry) => {
      const visible = filterReadableFields('evaluations', { id: entry.id, dataset_id: entry.dataset_id, testcase_id: entry.testcase_id, outcome: entry.outcome, text: entry.text, execution_time: entry.execution_time, execution_memory: entry.execution_memory }, permissions);
      return { id: visible.id ?? entry.id, datasetId: visible.dataset_id ?? entry.dataset_id, testcaseId: visible.testcase_id ?? entry.testcase_id, testcaseName: entry.testcases?.codename ?? null, outcome: toOutcome(visible.outcome ?? entry.outcome), text: [...(visible.text ?? entry.text)], executionTime: visible.execution_time ?? entry.execution_time, executionMemory: toMemoryString(entry.execution_memory) };
    }),
  };
}
