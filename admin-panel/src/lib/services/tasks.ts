import { prisma } from '@/lib/prisma';
import { requirePermission, ACTION_PERMISSIONS } from '@/lib/server/authorization';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { recordAudit } from '@/lib/audit';
import { sanitize } from '@/lib/api-utils';
import { LIMIT_FIELDS, normalizeLimitValue, normalizeNonNegativeInt } from '@/lib/limits';
import type { LimitPatch } from '@/lib/limit-patch';
import { buildDiagnosticsForLoadedTask, computeTaskDiagnostics } from '@/lib/task-diagnostics';
import { addIntervalClause, addNullableIntClause } from '@/lib/task-intervals';
import { taskSortOrderBy } from '@/lib/task-sorting';
import type { ListSortInput } from '@/lib/list-sorting';
import type { Prisma } from '@prisma/client';
export type { TaskDiagnostic } from '@/lib/task-diagnostics';
export interface TaskData {
  name: string; title: string; score_mode?: string;
  feedback_level?: string; score_precision?: number | null; allowed_languages?: string[];
  submission_format?: string[]; token_mode?: string; token_max_number?: number | null;
  token_min_interval?: number | null; token_gen_initial?: number | null; token_gen_number?: number | null;
  token_gen_interval?: number | null; token_gen_max?: number | null; max_submission_number?: number | null;
  max_user_test_number?: number | null; min_submission_interval?: number | null; min_user_test_interval?: number | null;
  // Why its own field: the throttle override is a nullable tri-state (null inherits, 0 is no delay,
  // N is N seconds), so it cannot share the LIMIT_FIELDS "0 means no limit" rule.
  evaluation_throttle_delay_s?: number | null;
}
const TASKS_PER_PAGE = 20;
const REQUIRED_INTERVAL_KEYS = new Set(['token_min_interval', 'token_gen_interval']);
const OPTIONAL_INTERVAL_KEYS = new Set(['min_submission_interval', 'min_user_test_interval']);
const INTERVAL_KEYS = new Set([...REQUIRED_INTERVAL_KEYS, ...OPTIONAL_INTERVAL_KEYS]);
/** The one task column that is neither a limit nor an interval: NULL inherits, 0 is "no delay". */
const THROTTLE_OVERRIDE_KEY = 'evaluation_throttle_delay_s';
/** Every key the hand-written UPDATE owns — the intervals and the throttle override. */
const RAW_COLUMN_KEYS = new Set([...INTERVAL_KEYS, THROTTLE_OVERRIDE_KEY]);
const ARRAY_KEYS = new Set(['submission_format', 'primary_statements', 'allowed_languages']);
const API_INTERVAL_KEYS = new Set([...INTERVAL_KEYS, THROTTLE_OVERRIDE_KEY, ...ARRAY_KEYS]);
const NULLABLE_TASK_KEYS = new Set(['token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', ...OPTIONAL_INTERVAL_KEYS]);
const NULLABLE_API_KEYS = new Set([...NULLABLE_TASK_KEYS, 'score_precision']);
const ZERO_DEFAULT_KEYS = new Set(['score_precision', 'token_gen_initial', 'token_gen_number']);
type MutationResult = { success: boolean; error?: string };
export type CreateTaskResult = MutationResult & { id?: number };
type TasksListResult = { tasks: Array<Prisma.tasksGetPayload<{ include: { contest_tasks: { select: { contest_id: true; contests: { select: { id: true; name: true } } } }; statements: { select: { id: true } }; datasets_datasets_task_idTotasks: { select: { id: true; description: true; _count: { select: { testcases: true } } } }; _count: { select: { submissions: true } } } }> & { diagnostics: ReturnType<typeof buildDiagnosticsForLoadedTask> }>; totalPages: number; total: number; };
export async function listTasks(params: { page?: number; search?: string; sort?: ListSortInput } = {}): Promise<TasksListResult> {
  await requirePermission('task:list');
  const skip = ((params.page ?? 1) - 1) * TASKS_PER_PAGE;
  const where: Prisma.tasksWhereInput = params.search ? { OR: [{ name: { contains: params.search, mode: 'insensitive' } }, { title: { contains: params.search, mode: 'insensitive' } }] } : {};
  const [rawTasks, total] = await Promise.all([
    prisma.tasks.findMany({ where, skip, take: TASKS_PER_PAGE, orderBy: taskSortOrderBy(params.sort ?? null), include: { contest_tasks: { select: { contest_id: true, contests: { select: { id: true, name: true } } } }, statements: { select: { id: true } }, datasets_datasets_task_idTotasks: { select: { id: true, description: true, _count: { select: { testcases: true } } } }, _count: { select: { submissions: true } } } }),
    prisma.tasks.count({ where }),
  ]);
  return { tasks: rawTasks.map((t) => ({ ...t, diagnostics: buildDiagnosticsForLoadedTask(t) })), totalPages: Math.ceil(total / TASKS_PER_PAGE), total };
}
export async function getTaskDiagnostics(taskId: number): Promise<Awaited<ReturnType<typeof computeTaskDiagnostics>>> {
  await requirePermission('task:read');
  if (!taskId || Number.isNaN(taskId)) return [];
  return computeTaskDiagnostics(taskId);
}
export async function getDiagnosticsForApi(taskId: number): Promise<Awaited<ReturnType<typeof computeTaskDiagnostics>>> {
  await requirePermission('task:read');
  if (Number.isNaN(taskId)) { const e = new Error('Invalid ID') as Error & { status: number }; e.status = 400; throw e; }
  const t = await prisma.tasks.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!t) { const e = new Error('Task not found') as Error & { status: number }; e.status = 404; throw e; }
  return computeTaskDiagnostics(taskId);
}
function toIntervalString(v: number | null, unit: string, fb: string): string | null { if (v === null || v === undefined) return fb; return `${v} ${unit}`; }
/** A nullable interval as the "N unit" string Postgres reads, or null for a real NULL (no minimum). */
function nullableIntervalString(value: unknown, unit: 'seconds' | 'minutes'): string | null {
  const seconds = normalizeLimitValue(value);
  return seconds === null ? null : `${seconds} ${unit}`;
}
export async function createTask(data: TaskData): Promise<CreateTaskResult> {
  const perms = await requirePermission(ACTION_PERMISSIONS.createTask);
  const allowed = stripDisallowedFields('tasks', data as unknown as Record<string, unknown>, perms) as unknown as TaskData;
  const s = allowed as unknown as TaskData;
  try {
    const tokenMin = toIntervalString(sanitize(s.token_min_interval), 'seconds', '0 seconds') as string;
    const tokenGen = toIntervalString(sanitize(s.token_gen_interval), 'minutes', '30 minutes') as string;
    // Why NULL and not '0 seconds': the column's CHECK is `> '0 seconds'`, so "no minimum" must be
    // absent, not zero — the same rule the shared limit normaliser applies everywhere else.
    const minSub = nullableIntervalString(s.min_submission_interval, 'seconds');
    const minUser = nullableIntervalString(s.min_user_test_interval, 'seconds');
    const created = await prisma.$queryRaw<Array<{ id: number }>>`INSERT INTO tasks (name, title, submission_format, primary_statements, allowed_languages, token_mode, token_max_number, token_min_interval, token_gen_initial, token_gen_number, token_gen_interval, token_gen_max, max_submission_number, max_user_test_number, min_submission_interval, min_user_test_interval, evaluation_throttle_delay_s, feedback_level, score_precision, score_mode) VALUES (${s.name}, ${s.title}, ${s.submission_format ?? []}, ARRAY[]::varchar[], ${s.allowed_languages ?? []}, ${s.token_mode ?? 'disabled'}::token_mode, ${normalizeLimitValue(s.token_max_number)}, ${tokenMin}::interval, ${s.token_gen_initial ?? 0}, ${s.token_gen_number ?? 0}, ${tokenGen}::interval, ${normalizeLimitValue(s.token_gen_max)}, ${normalizeLimitValue(s.max_submission_number)}, ${normalizeLimitValue(s.max_user_test_number)}, ${minSub}::interval, ${minUser}::interval, ${normalizeNonNegativeInt(s.evaluation_throttle_delay_s)}, ${s.feedback_level ?? 'restricted'}::feedback_level, ${s.score_precision ?? 0}, ${s.score_mode ?? 'max'}::score_mode) RETURNING id`;
    await recordAudit({ verb: 'task:create', entity: 'task', afterValues: s, result: 'success' });
    return { success: true, id: created[0]?.id };
  } catch (e) { const msg = e instanceof Error ? e.message : 'Unknown error'; if (msg.includes('unique constraint')) return { success: false, error: 'Task name already exists' }; return { success: false, error: msg }; }
}
function cleanArray(arr: unknown): string[] { if (!Array.isArray(arr)) return []; return arr.filter((v) => v !== null && v !== '') as string[]; }
function buildIntervals(d: Record<string, unknown>): { tokenMin: string; tokenGen: string; minSub: string | null; minUser: string | null } {
  return { tokenMin: sanitize(d.token_min_interval as never) !== null ? `${d.token_min_interval} seconds` : '0 seconds', tokenGen: sanitize(d.token_gen_interval as never) !== null ? `${d.token_gen_interval} minutes` : '30 minutes', minSub: nullableIntervalString(d.min_submission_interval, 'seconds'), minUser: nullableIntervalString(d.min_user_test_interval, 'seconds') };
}
async function insertTaskForApi(data: Record<string, unknown>): Promise<number> {
  const { tokenMin, tokenGen, minSub, minUser } = buildIntervals(data);
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`INSERT INTO tasks (name, title, submission_format, primary_statements, allowed_languages, token_mode, token_max_number, token_min_interval, token_gen_initial, token_gen_number, token_gen_interval, token_gen_max, max_submission_number, max_user_test_number, min_submission_interval, min_user_test_interval, evaluation_throttle_delay_s, feedback_level, score_precision, score_mode) VALUES (${data.name as string}, ${data.title as string}, ${cleanArray(data.submission_format).map((f: string) => f.replace(/%s/g, data.name as string))}::varchar[], ${cleanArray(data.primary_statements)}::varchar[], ${cleanArray(data.allowed_languages)}::varchar[], ${(data.token_mode as string) ?? 'disabled'}::token_mode, ${normalizeLimitValue(data.token_max_number)}, ${tokenMin}::interval, ${(data.token_gen_initial as number) ?? 0}, ${(data.token_gen_number as number) ?? 0}, ${tokenGen}::interval, ${normalizeLimitValue(data.token_gen_max)}, ${normalizeLimitValue(data.max_submission_number)}, ${normalizeLimitValue(data.max_user_test_number)}, ${minSub}::interval, ${minUser}::interval, ${normalizeNonNegativeInt(data.evaluation_throttle_delay_s)}, ${(data.feedback_level as string) ?? 'restricted'}::feedback_level, ${(data.score_precision as number) ?? 0}, ${(data.score_mode as string) ?? 'max'}::score_mode) RETURNING id`;
  return rows[0]?.id ?? 0;
}
export async function createTaskViaApi(data: Record<string, unknown>): Promise<CreateTaskResult> {
  await requirePermission(ACTION_PERMISSIONS.createTask);
  const name = typeof data.name === 'string' ? data.name.trim() : ''; const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!name) { const e = new Error('Task name is required') as Error & { status: number }; e.status = 400; throw e; }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) { const e = new Error('Task name must contain only letters, numbers, hyphens and underscores') as Error & { status: number }; e.status = 400; throw e; }
  if (!title) { const e = new Error('Task title is required') as Error & { status: number }; e.status = 400; throw e; }
  try { const id = await insertTaskForApi(data); await recordAudit({ verb: 'task:create', entity: 'task', afterValues: { name, title }, result: 'success' }); return { success: true, id }; } catch (e) { const msg = (e as Error).message; if (msg?.includes('unique constraint')) { const er = new Error('Task name already exists') as Error & { status: number }; er.status = 400; throw er; } throw e; }
}
function splitTaskData(data: Partial<TaskData>): { standardFields: Record<string, unknown>; rawFields: Record<string, unknown> } {
  const sanitized: Record<string, unknown> = {}; for (const k in data) sanitized[k] = sanitize((data as Record<string, unknown>)[k] as never);
  // Why here: every limit column passes through the one rule, so a 0 or a blank becomes NULL before
  // it can reach a CHECK. The two min intervals then land in rawFields as null, which
  // addIntervalClause writes as a real NULL clause — the explicit clear.
  for (const field of LIMIT_FIELDS) if (field in sanitized) sanitized[field] = normalizeLimitValue(sanitized[field]);
  // Why its own rule: the throttle override is not a limit — a 0 stays a 0 ("no delay for this
  // task") and only a blank or a negative becomes null ("inherit the contest's").
  if (THROTTLE_OVERRIDE_KEY in sanitized) sanitized[THROTTLE_OVERRIDE_KEY] = normalizeNonNegativeInt(sanitized[THROTTLE_OVERRIDE_KEY]);
  const std: Record<string, unknown> = {}; const raw: Record<string, unknown> = {};
  for (const k in sanitized) { if (RAW_COLUMN_KEYS.has(k)) { if (REQUIRED_INTERVAL_KEYS.has(k) && sanitized[k] === null) continue; raw[k] = sanitized[k]; } else if (sanitized[k] !== null || NULLABLE_TASK_KEYS.has(k)) std[k] = sanitized[k]; }
  return { standardFields: std, rawFields: raw };
}
async function applyTaskRawColumns(id: number, raw: Record<string, unknown>): Promise<void> {
  const clauses: string[] = []; const p: unknown[] = [];
  addIntervalClause(clauses, p, raw, 'token_min_interval', 'seconds'); addIntervalClause(clauses, p, raw, 'token_gen_interval', 'minutes');
  addIntervalClause(clauses, p, raw, 'min_submission_interval', 'seconds'); addIntervalClause(clauses, p, raw, 'min_user_test_interval', 'seconds');
  // The throttle override is written here, not through prisma.tasks.update: the generated client
  // predates the column (scripts/__fix_db_schema.sql adds it), so a typed update would reject it.
  addNullableIntClause(clauses, p, raw, THROTTLE_OVERRIDE_KEY);
  if (clauses.length === 0) return; p.push(id); await prisma.$executeRawUnsafe(`UPDATE tasks SET ${clauses.join(', ')} WHERE id = $${p.length}`, ...p);
}
export async function updateTask(id: number, data: Partial<TaskData>): Promise<MutationResult> {
  const perms = await requirePermission(ACTION_PERMISSIONS.updateTask);
  const allowed = stripDisallowedFields('tasks', data as unknown as Record<string, unknown>, perms) as unknown as Partial<TaskData>;
  const s = allowed as unknown as Partial<TaskData>;
  try {
    const { standardFields, rawFields } = splitTaskData(s);
    if (Object.keys(standardFields).length > 0) await prisma.tasks.update({ where: { id }, data: standardFields });
    if (Object.keys(rawFields).length > 0) await applyTaskRawColumns(id, rawFields);
    await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(id), afterValues: s, result: 'success' });
    return { success: true };
  } catch (e) { const code = (e as { code?: string }).code; if (code === 'P2002') return { success: false, error: 'Task name already exists' }; return { success: false, error: e instanceof Error ? e.message : 'An unexpected error occurred' }; }
}
function sanitizeTaskDataForApi(raw: Record<string, unknown>): Record<string, unknown> { const s: Record<string, unknown> = {}; for (const k in raw) s[k] = sanitize(raw[k] as never); for (const field of LIMIT_FIELDS) if (field in s) s[field] = normalizeLimitValue(s[field]); if (THROTTLE_OVERRIDE_KEY in s) s[THROTTLE_OVERRIDE_KEY] = normalizeNonNegativeInt(s[THROTTLE_OVERRIDE_KEY]); return s; }
/**
 * The bulk limit write: apply one already-whitelisted limit patch to a single task through the same
 * permission gate and the same split/interval writers a full task update uses, so the batch route
 * never touches SQL itself and the whitelist stays in `pickLimitPatch`. It reports a refusal per
 * target so the route can name the ones that did not take.
 */
export async function updateTaskLimits(id: number, patch: LimitPatch): Promise<MutationResult> {
  const perms = await requirePermission(ACTION_PERMISSIONS.updateTask);
  const allowed = stripDisallowedFields('tasks', patch as unknown as Record<string, unknown>, perms) as unknown as LimitPatch;
  const exists = await prisma.tasks.findUnique({ where: { id }, select: { id: true } });
  if (exists === null) return { success: false, error: 'Task not found' };
  const s: Partial<TaskData> = {};
  for (const field of LIMIT_FIELDS) if (field in allowed) s[field] = allowed[field];
  try {
    const { standardFields, rawFields } = splitTaskData(s);
    if (Object.keys(standardFields).length > 0) await prisma.tasks.update({ where: { id }, data: standardFields });
    if (Object.keys(rawFields).length > 0) await applyTaskRawColumns(id, rawFields);
    await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(id), afterValues: s, result: 'success' });
    return { success: true };
  } catch (e) { const code = (e as { code?: string }).code; if (code === 'P2002') return { success: false, error: 'Task name already exists' }; return { success: false, error: e instanceof Error ? e.message : 'An unexpected error occurred' }; }
}
/** Every task a limit patch can target, for the shared apply-to-targets picker. */
export async function listTaskTargets(): Promise<Array<{ id: number; name: string }>> {
  await requirePermission('task:list');
  return prisma.tasks.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
}
async function normalizeSubmissionFormat(data: Record<string, unknown>, taskId: number): Promise<void> {
  if (!Array.isArray(data.submission_format)) return; data.submission_format = (data.submission_format as unknown[]).filter((v) => v !== null);
  if (!(data.submission_format as string[]).some((f) => f.includes('%s'))) return;
  let n = data.name as string | undefined; if (!n) { const ex = await prisma.tasks.findUnique({ where: { id: taskId }, select: { name: true } }); n = ex?.name ?? undefined; }
  if (n) data.submission_format = (data.submission_format as string[]).map((f) => f.replace(/%s/g, n as string));
}
function splitFieldsForApi(s: Record<string, unknown>): { standardFields: Record<string, unknown>; intervalFields: Record<string, unknown> } {
  const std: Record<string, unknown> = {}; const iv: Record<string, unknown> = {};
  for (const k in s) { if (API_INTERVAL_KEYS.has(k)) { if (REQUIRED_INTERVAL_KEYS.has(k) && s[k] === null) continue; iv[k] = s[k]; } else if (s[k] !== null || NULLABLE_API_KEYS.has(k)) { if (s[k] === null && ZERO_DEFAULT_KEYS.has(k)) std[k] = 0; else std[k] = s[k]; } }
  return { standardFields: std, intervalFields: iv };
}
async function applyTaskUpdatesForApi(id: number, std: Record<string, unknown>, iv: Record<string, unknown>): Promise<void> {
  if (Object.keys(std).length > 0) await prisma.tasks.update({ where: { id }, data: std }); if (Object.keys(iv).length === 0) return;
  const clauses: string[] = []; const q: unknown[] = [];
  addIntervalClause(clauses, q, iv, 'token_min_interval', 'seconds'); addIntervalClause(clauses, q, iv, 'token_gen_interval', 'minutes');
  addIntervalClause(clauses, q, iv, 'min_submission_interval', 'seconds'); addIntervalClause(clauses, q, iv, 'min_user_test_interval', 'seconds');
  addNullableIntClause(clauses, q, iv, THROTTLE_OVERRIDE_KEY);
  if (iv.submission_format !== undefined) { q.push(iv.submission_format); clauses.push(`submission_format = $${q.length}::varchar[]`); }
  if (iv.primary_statements !== undefined) { q.push(iv.primary_statements); clauses.push(`primary_statements = $${q.length}::varchar[]`); }
  if (iv.allowed_languages !== undefined) { if (iv.allowed_languages === null) clauses.push(`allowed_languages = NULL`); else { q.push(iv.allowed_languages); clauses.push(`allowed_languages = $${q.length}::varchar[]`); } }
  if (clauses.length > 0) { q.push(id); await prisma.$executeRawUnsafe(`UPDATE tasks SET ${clauses.join(', ')} WHERE id = $${q.length}`, ...q); }
}
export async function updateTaskViaApi(id: number, raw: Record<string, unknown>): Promise<MutationResult> {
  await requirePermission(ACTION_PERMISSIONS.updateTask); if (Number.isNaN(id)) { const e = new Error('Invalid ID') as Error & { status: number }; e.status = 400; throw e; }
  const s = sanitizeTaskDataForApi(raw); await normalizeSubmissionFormat(s, id);
  const { standardFields, intervalFields } = splitFieldsForApi(s);
  try { await applyTaskUpdatesForApi(id, standardFields, intervalFields); await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(id), afterValues: { changedKeys: [...Object.keys(standardFields), ...Object.keys(intervalFields)] }, result: 'success' }); return { success: true }; } catch (e) { const code = (e as { code?: string }).code; if (code === 'P2002') { const er = new Error('Task name already exists') as Error & { status: number }; er.status = 400; throw er; } throw e; }
}
export async function deleteTask(id: number): Promise<MutationResult> {
  await requirePermission(ACTION_PERMISSIONS.deleteTask); const before = await prisma.tasks.findUnique({ where: { id } });
  try { await prisma.tasks.delete({ where: { id } }); await recordAudit({ verb: 'task:delete', entity: 'task', entityId: String(id), beforeValues: before ?? undefined, result: 'success' }); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; }
}
export async function deleteTaskViaApi(id: number): Promise<MutationResult> {
  await requirePermission(ACTION_PERMISSIONS.deleteTask); if (Number.isNaN(id)) { const e = new Error('Invalid ID') as Error & { status: number }; e.status = 400; throw e; }
  const before = await prisma.tasks.findUnique({ where: { id }, select: { name: true, title: true } });
  try { await prisma.tasks.delete({ where: { id } }); await recordAudit({ verb: 'task:delete', entity: 'task', entityId: String(id), beforeValues: before ? { name: before.name, title: before.title } : undefined, result: 'success' }); return { success: true }; } catch (e) { throw e; }
}
const ASSIGN_NUM_ATTEMPTS = 5;

/** True only for the (contest_id, num) index, so a duplicate membership is not retried forever. */
function isContestTaskNumConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } };
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes('num');
}

export async function assignTaskToContest(taskId: number, contestId: number | null): Promise<MutationResult> {
  await requirePermission('task:update');
  // Why both: attaching a task rewires its active dataset path, so the caller
  // needs the dataset-switch right as well as task update.
  await requirePermission('task:switch_dataset');
  try {
    // Unassign: drop every contest membership, the task itself survives.
    if (contestId === null) {
      await prisma.contest_tasks.deleteMany({ where: { task_id: taskId } });
      await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(taskId), afterValues: { contest_id: null }, result: 'success' });
      return { success: true };
    }
    const existing = await prisma.contest_tasks.findUnique({
      where: { contest_id_task_id: { contest_id: contestId, task_id: taskId } },
    });
    if (existing) return { success: true };

    // Why the retry: the next number is read as MAX(num) + 1, so two assignments racing in the
    // same contest read the same maximum and pick the same number — the first wins and the rest
    // fail the (contest_id, num) unique index. Re-reading on that exact conflict lets the losers
    // converge instead of surfacing a write error for a retryable collision.
    let assignedNum: number | null = null;
    for (let attempt = 1; ; attempt += 1) {
      const m = await prisma.contest_tasks.aggregate({ where: { contest_id: contestId }, _max: { num: true } });
      assignedNum = (m._max.num ?? 0) + 1;
      try {
        await prisma.contest_tasks.create({ data: { contest_id: contestId, task_id: taskId, num: assignedNum } });
        break;
      } catch (error) {
        if (attempt >= ASSIGN_NUM_ATTEMPTS || !isContestTaskNumConflict(error)) throw error;
      }
    }
    await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(taskId), afterValues: { contest_id: contestId, num: assignedNum }, result: 'success' });
    return { success: true };
  } catch (e) { return { success: false, error: (e as Error).message }; }
}
