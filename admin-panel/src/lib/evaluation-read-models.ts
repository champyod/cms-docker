import { prisma } from '@/lib/prisma';
import { getFieldAccess } from '@/lib/field-permissions';
import { requirePermission } from '@/lib/server/authorization';
import type {
  SubmissionEvaluationModel,
  SubmissionLogsModel,
  SubmissionResultsModel,
  SubmissionSummary,
} from '@/lib/evaluation-read-model-types';
import {
  readContest,
  readSubmissionCapabilities,
  readTask,
  readUser,
  toIso,
  toSubmissionEvaluationRow,
  toSubmissionFileRow,
  toSubmissionLogRow,
  toSubmissionResultRow,
  type SubmissionEvaluationRow,
  type SubmissionLogRow,
} from '@/lib/evaluation-read-model-projections';

const SUBMISSION_SUMMARY_SELECT = {
  id: true,
  timestamp: true,
  language: true,
  comment: true,
  official: true,
  participations: {
    select: {
      users: { select: { id: true, username: true } },
      contests: { select: { id: true, name: true } },
    },
  },
  tasks: { select: { id: true, name: true, title: true } },
} as const;

const SUBMISSION_RESULT_SELECT = {
  dataset_id: true,
  compilation_outcome: true,
  evaluation_outcome: true,
  compilation_time: true,
  compilation_memory: true,
  score: true,
  public_score: true,
  scored_at: true,
} as const;

const SUBMISSION_LOG_SELECT = {
  compilation_outcome: true,
  compilation_text: true,
  compilation_stdout: true,
  compilation_stderr: true,
} as const;

const SUBMISSION_FILE_SELECT = { id: true, filename: true, digest: true } as const;

const SUBMISSION_EVALUATION_SELECT = {
  id: true,
  dataset_id: true,
  testcase_id: true,
  outcome: true,
  text: true,
  execution_time: true,
  execution_memory: true,
  testcases: { select: { codename: true } },
} as const;

// Why no field projection here: every column this reader returns is bound to
// `submission:read` in the submissions field map, and that key is required
// before the query runs, so the projection could never strip one. Projecting
// anyway would add a second permission decision with no reachable outcome.
export async function getSubmissionSummary(submissionId: number): Promise<SubmissionSummary | null> {
  const permissions = await requirePermission('submission:read');
  const row = await prisma.submissions.findUnique({
    where: { id: submissionId },
    select: SUBMISSION_SUMMARY_SELECT,
  });
  if (!row) return null;
  return {
    id: row.id,
    timestamp: toIso(row.timestamp) ?? '',
    language: row.language,
    comment: row.comment,
    official: row.official,
    user: readUser(row.participations?.users ?? null, permissions),
    contest: readContest(row.participations?.contests ?? null, permissions),
    task: readTask(row.tasks ?? null, permissions),
    capabilities: readSubmissionCapabilities(permissions),
  };
}

export async function getSubmissionResults(submissionId: number): Promise<SubmissionResultsModel | null> {
  const permissions = new Set<string>([
    ...await requirePermission('submission:read'),
    ...await requirePermission('submissionresult:read'),
    ...await requirePermission('file:read'),
  ]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const [results, files] = await Promise.all([
    prisma.submission_results.findMany({
      where: { submission_id: submissionId },
      orderBy: { dataset_id: 'asc' },
      select: SUBMISSION_RESULT_SELECT,
    }),
    prisma.files.findMany({
      where: { submission_id: submissionId },
      orderBy: { filename: 'asc' },
      select: SUBMISSION_FILE_SELECT,
    }),
  ]);
  const resultsAccess = getFieldAccess('submission_results', permissions);
  const filesAccess = getFieldAccess('files', permissions);
  return {
    submissionId,
    results: results.map((entry) => toSubmissionResultRow(entry, resultsAccess)),
    files: files.map((entry) => toSubmissionFileRow(entry, filesAccess)),
  };
}

export async function getSubmissionLogs(submissionId: number): Promise<SubmissionLogsModel | null> {
  const permissions = new Set<string>([
    ...await requirePermission('submission:read'),
    ...await requirePermission('submissionresult:read'),
  ]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const [entry] = await prisma.submission_results.findMany({
    where: { submission_id: submissionId },
    orderBy: { dataset_id: 'asc' },
    take: 1,
    select: SUBMISSION_LOG_SELECT,
  });
  const empty: SubmissionLogRow = {
    compilation_outcome: null,
    compilation_text: [],
    compilation_stdout: null,
    compilation_stderr: null,
  };
  return { submissionId, ...toSubmissionLogRow(entry ?? empty, getFieldAccess('submission_results', permissions)) };
}

export async function getSubmissionEvaluation(submissionId: number): Promise<SubmissionEvaluationModel | null> {
  const permissions = new Set<string>([
    ...await requirePermission('submission:read'),
    ...await requirePermission('evaluation:read'),
  ]);
  const parent = await prisma.submissions.findUnique({ where: { id: submissionId }, select: { id: true } });
  if (!parent) return null;
  const rows = await prisma.evaluations.findMany({
    where: { submission_id: submissionId },
    orderBy: { testcase_id: 'asc' },
    select: SUBMISSION_EVALUATION_SELECT,
  });
  const evaluationsAccess = getFieldAccess('evaluations', permissions);
  return {
    submissionId,
    evaluations: rows.map((entry) => toSubmissionEvaluationRow(
      { ...entry, codename: entry.testcases?.codename ?? null } satisfies SubmissionEvaluationRow,
      evaluationsAccess,
    )),
  };
}
