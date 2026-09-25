import type { Prisma } from '@prisma/client';
import { filterReadableFields } from '@/lib/field-permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

export type TaskDetailSummary = {
  id: number; name: string; title: string; contest: { id: number; name: string } | null;
  permissionKeys: readonly string[];
};

export type TaskStatementSummary = {
  id: number; language: string; digest: string; filename: string;
  size: number | null; uploadedAt: string | null;
};

export type TaskDatasetSummary = {
  id: number; description: string; time_limit: number | null; memory_limit: string | null;
  task_type: string; score_type: string; autojudge: boolean;
  task_type_parameters: unknown; score_type_parameters: unknown;
  testcases: Array<{ id: number; codename: string; public: boolean }>;
};

export type TaskAttachmentSummary = { id: number; filename: string };

export type TaskSettingsRecord = {
  id: number; name: string; title: string; score_mode: string; feedback_level: string;
  score_precision: number | null; allowed_languages: string[]; submission_format: string[];
  token_mode: string; token_max_number: number | null; token_min_interval: string | null;
  token_gen_initial: number | null; token_gen_number: number | null; token_gen_interval: string | null; token_gen_max: number | null;
  max_submission_number: number | null; max_user_test_number: number | null; min_submission_interval: string | null; min_user_test_interval: string | null;
};

export type TaskOverviewData = {
  task: { id: number; name: string; title: string; score_precision: number | null; score_mode: string; feedback_level: string; submissions: number };
  statements: readonly TaskStatementSummary[]; permissionKeys: readonly string[];
};

export type TaskDatasetsData = {
  taskId: number; activeDatasetId: number | null; datasets: readonly TaskDatasetSummary[];
  permissionKeys: readonly string[];
};

export type TaskFilesData = { taskId: number; attachments: readonly TaskAttachmentSummary[]; permissionKeys: readonly string[] };

export type TaskSettingsData = { task: TaskSettingsRecord; permissionKeys: readonly string[] };

type RawStatement = { id: number; language: string; digest: string };

// Why: statement blobs live outside Prisma models — a missing fsobject row
// degrades to an unknown size instead of failing the whole overview read.
async function fetchStatementSize(digest: string): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ size: number }>>`SELECT octet_length(lo_get(loid))::int AS size FROM fsobjects WHERE digest = ${digest}`;
    return rows.length > 0 ? Number(rows[0].size) : null;
  } catch {
    return null;
  }
}

async function fetchStatementSizes(statements: readonly RawStatement[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const statement of statements) {
    const size = await fetchStatementSize(statement.digest);
    if (size !== null) sizes.set(statement.digest, size);
  }
  return sizes;
}

// Why: upload dates come from audit history, which is best-effort context —
// an audit lookup failure degrades to unknown dates, never a failed read.
async function fetchStatementUploadDates(taskId: number, statements: readonly RawStatement[]): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  let audits: Array<{ timestamp: Date; after_values: unknown }>;
  try {
    audits = await prisma.audit_log.findMany({ where: { verb: 'statement:create', entity: 'statement' }, orderBy: { timestamp: 'desc' }, take: 100 });
  } catch {
    return dates;
  }
  for (const statement of statements) {
    const hit = audits.find((entry) => {
      const after = entry.after_values as Record<string, unknown> | null;
      return !!after && String(after.taskId ?? after.task_id ?? '') === String(taskId) && String(after.language ?? '') === statement.language;
    });
    if (hit) dates.set(statement.language, hit.timestamp.toISOString());
  }
  return dates;
}

// Why: enrichment moved here from the all-in-one getTask service so the
// overview read keeps digest/file metadata without importing that service.
async function enrichStatements(taskId: number, statements: readonly RawStatement[]): Promise<TaskStatementSummary[]> {
  if (statements.length === 0) return [];
  const [sizes, dates] = await Promise.all([fetchStatementSizes(statements), fetchStatementUploadDates(taskId, statements)]);
  return statements.map((statement) => ({
    id: statement.id, language: statement.language, digest: statement.digest, filename: `${statement.language}.pdf`,
    size: sizes.get(statement.digest) ?? null, uploadedAt: dates.get(statement.language) ?? null,
  }));
}

function toMemoryString(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toIntervalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const part = value as { days?: unknown; hours?: unknown; minutes?: unknown; seconds?: unknown };
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return String(num(part.days) * 86400 + num(part.hours) * 3600 + num(part.minutes) * 60 + num(part.seconds));
  }
  return String(value);
}

export async function getTaskDetailSummary(taskId: number): Promise<TaskDetailSummary | null> {
  const permissions = await requirePermission('task:read');
  // Why: the contest name needs its own contest:read projection — without it
  // the query skips the relation and the result carries contest: null.
  const canReadContest = hasEffectivePermission(permissions, 'contest:read');
  const row = canReadContest
    ? await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true, name: true, title: true, contests: { select: { id: true, name: true } } } })
    : await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true, name: true, title: true } });
  if (!row) return null;
  const visible = filterReadableFields('tasks', { id: row.id, name: row.name, title: row.title }, permissions);
  const contestRelation = canReadContest ? (row as { contests?: { id: number; name: string } | null }).contests : undefined;
  const contest = contestRelation ? { id: contestRelation.id, name: contestRelation.name } : null;
  return {
    id: visible.id ?? row.id, name: visible.name ?? row.name, title: visible.title ?? row.title,
    contest, permissionKeys: [...permissions],
  };
}

export async function getTaskOverview(taskId: number): Promise<TaskOverviewData | null> {
  const permissions = new Set<string>([...await requirePermission('task:read'), ...await requirePermission('statement:read')]);
  // Why: overview carries config, counts, and statements only — datasets stay on their own boundary.
  const row = await prisma.tasks.findUnique({
    where: { id: taskId },
    select: {
      id: true, name: true, title: true, score_precision: true, score_mode: true, feedback_level: true,
      _count: { select: { submissions: true } },
      statements: { select: { id: true, language: true, digest: true } },
    },
  });
  if (!row) return null;
  const visible = filterReadableFields('tasks', { id: row.id, name: row.name, title: row.title, score_precision: row.score_precision, score_mode: row.score_mode, feedback_level: row.feedback_level }, permissions);
  const statements = await enrichStatements(row.id, row.statements ?? []);
  return {
    task: {
      id: visible.id ?? row.id, name: visible.name ?? row.name, title: visible.title ?? row.title,
      score_precision: visible.score_precision ?? row.score_precision, score_mode: String(visible.score_mode ?? row.score_mode),
      feedback_level: String(visible.feedback_level ?? row.feedback_level), submissions: row._count.submissions,
    },
    statements, permissionKeys: [...permissions],
  };
}

type DatasetEntry = {
  id: number; description: string; time_limit: number | null; memory_limit: bigint | number | null; task_type: string; score_type: string;
  autojudge: boolean; task_type_parameters: unknown; score_type_parameters: unknown;
  testcases?: Array<{ id: number; codename: string; public: boolean }>;
};

function toDatasetSummary(dataset: DatasetEntry, permissions: ReadonlySet<string>): TaskDatasetSummary {
  const visible = filterReadableFields('datasets', { id: dataset.id, description: dataset.description, time_limit: dataset.time_limit,
    task_type: dataset.task_type, score_type: dataset.score_type, autojudge: dataset.autojudge }, permissions);
  const showTestcases = hasEffectivePermission(permissions, 'testcase:read');
  return {
    id: visible.id ?? dataset.id, description: visible.description ?? dataset.description,
    time_limit: visible.time_limit ?? dataset.time_limit,
    memory_limit: toMemoryString(dataset.memory_limit),
    task_type: visible.task_type ?? dataset.task_type, score_type: visible.score_type ?? dataset.score_type,
    autojudge: visible.autojudge ?? dataset.autojudge,
    task_type_parameters: dataset.task_type_parameters, score_type_parameters: dataset.score_type_parameters,
    testcases: showTestcases && 'testcases' in dataset && dataset.testcases
      ? dataset.testcases.map((testcase) => ({ id: testcase.id, codename: testcase.codename, public: testcase.public }))
      : [],
  };
}

export async function getTaskDatasets(taskId: number): Promise<TaskDatasetsData | null> {
  const permissions = new Set<string>([...await requirePermission('task:read'), ...await requirePermission('dataset:read')]);
  // Why: testcases need testcase:read — without it each dataset carries testcases: [].
  const datasetSelect = {
    id: true, description: true, time_limit: true, memory_limit: true, task_type: true,
    score_type: true, autojudge: true, task_type_parameters: true, score_type_parameters: true,
  };
  const row = hasEffectivePermission(permissions, 'testcase:read')
    ? await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true, active_dataset_id: true, datasets_datasets_task_idTotasks: { select: { ...datasetSelect, testcases: { select: { id: true, codename: true, public: true } } } } } })
    : await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true, active_dataset_id: true, datasets_datasets_task_idTotasks: { select: datasetSelect } } });
  if (!row) return null;
  return {
    taskId, activeDatasetId: row.active_dataset_id,
    datasets: row.datasets_datasets_task_idTotasks.map((dataset) => toDatasetSummary(dataset, permissions)), permissionKeys: [...permissions],
  };
}

export async function getTaskFiles(taskId: number): Promise<TaskFilesData | null> {
  const permissions = new Set<string>([...await requirePermission('task:read'), ...await requirePermission('attachment:read')]);
  // Why: attachments have no field-permission table entry, so the
  // attachment:read gate plus this id/filename-only projection is the filter.
  const row = await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true, attachments: { select: { id: true, filename: true } } } });
  if (!row) return null;
  return { taskId, attachments: row.attachments.map((attachment) => ({ id: attachment.id, filename: attachment.filename })), permissionKeys: [...permissions] };
}

const taskSettingsSelect = {
  id: true, name: true, title: true, score_mode: true, feedback_level: true, score_precision: true,
  allowed_languages: true, submission_format: true, token_mode: true, token_max_number: true,
  token_gen_initial: true, token_gen_number: true, token_gen_max: true,
  max_submission_number: true, max_user_test_number: true,
} satisfies Prisma.tasksSelect;

// Why: interval columns are Unsupported in the generated select types, so a
// typed raw query carries them while the explicit select stays relation-free.
type IntervalColumns = { token_min_interval: unknown; token_gen_interval: unknown; min_submission_interval: unknown; min_user_test_interval: unknown };

async function fetchTaskIntervals(taskId: number): Promise<IntervalColumns> {
  const rows = await prisma.$queryRaw<IntervalColumns[]>`SELECT token_min_interval, token_gen_interval, min_submission_interval, min_user_test_interval FROM tasks WHERE id = ${taskId}`;
  return rows[0] ?? { token_min_interval: null, token_gen_interval: null, min_submission_interval: null, min_user_test_interval: null };
}

type TaskSettingsRow = Prisma.tasksGetPayload<{ select: typeof taskSettingsSelect }> & IntervalColumns;

export async function getTaskSettings(taskId: number): Promise<TaskSettingsData | null> {
  const permissions = await requirePermission('task:read');
  const [row, intervals] = await Promise.all([
    prisma.tasks.findUnique({ where: { id: taskId }, select: taskSettingsSelect }),
    fetchTaskIntervals(taskId),
  ]);
  if (!row) return null;
  const full: TaskSettingsRow = { ...row, ...intervals };
  const visible = filterReadableFields('tasks', full, permissions);
  const pick = <K extends keyof TaskSettingsRow>(key: K): TaskSettingsRow[K] => (visible[key] ?? full[key]) as TaskSettingsRow[K];
  return {
    task: {
      id: pick('id'), name: pick('name'), title: pick('title'),
      score_mode: String(pick('score_mode')), feedback_level: String(pick('feedback_level')),
      score_precision: pick('score_precision'),
      allowed_languages: [...pick('allowed_languages')], submission_format: [...pick('submission_format')],
      token_mode: String(pick('token_mode')), token_max_number: pick('token_max_number'),
      token_min_interval: toIntervalString(pick('token_min_interval')), token_gen_initial: pick('token_gen_initial'), token_gen_number: pick('token_gen_number'),
      token_gen_interval: toIntervalString(pick('token_gen_interval')), token_gen_max: pick('token_gen_max'),
      max_submission_number: pick('max_submission_number'), max_user_test_number: pick('max_user_test_number'),
      min_submission_interval: toIntervalString(pick('min_submission_interval')), min_user_test_interval: toIntervalString(pick('min_user_test_interval')),
    },
    permissionKeys: [...permissions],
  };
}
