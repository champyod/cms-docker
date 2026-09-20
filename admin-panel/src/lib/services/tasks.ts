import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getFreshPermissions } from '@/lib/permissions';
import type { PermissionKey } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { recordAudit } from '@/lib/audit';
import { sanitize } from '@/lib/api-utils';
import { buildDiagnosticsForLoadedTask, computeTaskDiagnostics } from '@/lib/task-diagnostics';
import { addIntervalClause } from '@/lib/task-intervals';
import type { Prisma } from '@prisma/client';
export type { TaskDiagnostic } from '@/lib/task-diagnostics';
export interface TaskData {
  name: string; title: string; contest_id?: number | null; score_mode?: string;
  feedback_level?: string; score_precision?: number | null; allowed_languages?: string[];
  submission_format?: string[]; token_mode?: string; token_max_number?: number | null;
  token_min_interval?: number | null; token_gen_initial?: number | null; token_gen_number?: number | null;
  token_gen_interval?: number | null; token_gen_max?: number | null; max_submission_number?: number | null;
  max_user_test_number?: number | null; min_submission_interval?: number | null; min_user_test_interval?: number | null;
}
const TASKS_PER_PAGE = 20;
type MutationResult = { success: boolean; error?: string };
type TasksListResult = { tasks: Array<Prisma.tasksGetPayload<{ include: { contests: { select: { id: true; name: true } }; statements: { select: { id: true } }; datasets_datasets_task_idTotasks: { select: { id: true; description: true; _count: { select: { testcases: true } } } }; _count: { select: { submissions: true } } } }> & { diagnostics: ReturnType<typeof buildDiagnosticsForLoadedTask> }>; totalPages: number; total: number; };
// Why: permission failure as thrown error lets adapters map to throw vs 401/403 JSON without duplicating checks.
async function requirePermission(p: PermissionKey): Promise<ReadonlySet<string>> {
  const s = await getSession();
  if (!s) { const e = new Error('Unauthorized') as Error & { status: number }; e.status = 401; throw e; }
  const perms = await getFreshPermissions(s.userId);
  if (!perms || !hasEffectivePermission(perms, p)) { const e = new Error(`Unauthorized: Missing ${p} permission`) as Error & { status: number; permission: string }; e.status = 403; (e as unknown as { permission: string }).permission = p; throw e; }
  return perms;
}
export async function listTasks(params: { page?: number; search?: string } = {}): Promise<TasksListResult> {
  await requirePermission('task:list');
  const skip = ((params.page ?? 1) - 1) * TASKS_PER_PAGE;
  const where: Prisma.tasksWhereInput = params.search ? { OR: [{ name: { contains: params.search, mode: 'insensitive' } }, { title: { contains: params.search, mode: 'insensitive' } }] } : {};
  const [rawTasks, total] = await Promise.all([
    prisma.tasks.findMany({ where, skip, take: TASKS_PER_PAGE, orderBy: { id: 'desc' }, include: { contests: { select: { id: true, name: true } }, statements: { select: { id: true } }, datasets_datasets_task_idTotasks: { select: { id: true, description: true, _count: { select: { testcases: true } } } }, _count: { select: { submissions: true } } } }),
    prisma.tasks.count({ where }),
  ]);
  return { tasks: rawTasks.map((t) => ({ ...t, diagnostics: buildDiagnosticsForLoadedTask(t) })), totalPages: Math.ceil(total / TASKS_PER_PAGE), total };
}
type TaskDetailInclude = {
  contests: { select: { id: true; name: true; start: true; stop: true; analysis_start: true; analysis_stop: true } };
  statements: { select: { id: true; language: true; digest: true } };
  attachments: true;
  datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true; codename: true } }; managers: true } };
  _count: { select: { submissions: true } };
};
export type EnrichedStatement = { id: number; language: string; digest: string; filename: string; size: number | null; uploadedAt: string | null };
export type TaskWithStatements = Prisma.tasksGetPayload<{ include: TaskDetailInclude }> & { statements: EnrichedStatement[] };

export async function getTask(id: number): Promise<TaskWithStatements | null> {
  await requirePermission('task:read');
  const include = {
    contests: { select: { id: true, name: true, start: true, stop: true, analysis_start: true, analysis_stop: true } },
    statements: { select: { id: true, language: true, digest: true } },
    attachments: true,
    datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true, codename: true } }, managers: true } },
    _count: { select: { submissions: true } },
  } as const;
  const task = await prisma.tasks.findUnique({ where: { id }, include });
  if (!task) return null;
  const enriched = await enrichStatements(id, task.statements as Array<{ id: number; language: string; digest: string }>);
  return { ...task, statements: enriched } as unknown as TaskWithStatements;
}


async function enrichStatements(taskId: number, statements: Array<{ id: number; language: string; digest: string }>): Promise<EnrichedStatement[]> {
  if (statements.length === 0) return [];
  const sizeMap = new Map<string, number>();
  for (const s of statements) {
    try {
      const rows = await prisma.$queryRaw<Array<{ size: number }>>`SELECT octet_length(lo_get(loid))::int AS size FROM fsobjects WHERE digest = ${s.digest}`;
      if (rows.length > 0) sizeMap.set(s.digest, Number(rows[0].size));
    } catch {}
  }
  const dateMap = new Map<string, string>();
  try {
    const audits = await prisma.audit_log.findMany({ where: { verb: 'statement:create', entity: 'statement' }, orderBy: { timestamp: 'desc' }, take: 100 });
    for (const s of statements) {
      const hit = audits.find((a) => {
        const av = a.after_values as Record<string, unknown> | null;
        if (!av) return false;
        const t = String((av.taskId as unknown) ?? (av.task_id as unknown) ?? '');
        const l = String((av.language as unknown) ?? '');
        return t === String(taskId) && l === s.language;
      });
      if (hit) dateMap.set(s.language, hit.timestamp.toISOString());
    }
  } catch {}
  return statements.map((s) => ({
    ...s,
    filename: `${s.language}.pdf`,
    size: sizeMap.get(s.digest) ?? null,
    uploadedAt: dateMap.get(s.language) ?? null,
  }));
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
export async function createTask(data: TaskData): Promise<MutationResult> {
  const perms = await requirePermission('task:create');
  const allowed = stripDisallowedFields('tasks', data as unknown as Record<string, unknown>, perms) as unknown as TaskData;
  const s = allowed as unknown as TaskData;
  try {
    const tokenMin = toIntervalString(sanitize(s.token_min_interval), 'seconds', '0 seconds') as string;
    const tokenGen = toIntervalString(sanitize(s.token_gen_interval), 'minutes', '30 minutes') as string;
    const minSub = toIntervalString(sanitize(s.min_submission_interval), 'seconds', '0 seconds') as string;
    const minUser = toIntervalString(sanitize(s.min_user_test_interval), 'seconds', '0 seconds') as string;
    await prisma.$executeRaw`INSERT INTO tasks (name, title, contest_id, num, submission_format, primary_statements, allowed_languages, token_mode, token_max_number, token_min_interval, token_gen_initial, token_gen_number, token_gen_interval, token_gen_max, max_submission_number, max_user_test_number, min_submission_interval, min_user_test_interval, feedback_level, score_precision, score_mode) VALUES (${s.name}, ${s.title}, ${sanitize(s.contest_id)}, null, ${s.submission_format ?? []}, ARRAY[]::varchar[], ${s.allowed_languages ?? []}, ${s.token_mode ?? 'disabled'}::token_mode, ${sanitize(s.token_max_number)}, ${tokenMin}::interval, ${s.token_gen_initial ?? 0}, ${s.token_gen_number ?? 0}, ${tokenGen}::interval, ${sanitize(s.token_gen_max)}, ${sanitize(s.max_submission_number)}, ${sanitize(s.max_user_test_number)}, ${minSub}::interval, ${minUser}::interval, ${s.feedback_level ?? 'restricted'}::feedback_level, ${s.score_precision ?? 0}, ${s.score_mode ?? 'max'}::score_mode)`;
    await recordAudit({ verb: 'task:create', entity: 'task', afterValues: s, result: 'success' });
    return { success: true };
  } catch (e) { const msg = e instanceof Error ? e.message : 'Unknown error'; if (msg.includes('unique constraint')) return { success: false, error: 'Task name already exists' }; return { success: false, error: msg }; }
}
function nullablePositive(val: unknown): number | null { const s = sanitize(val as string | number | null | undefined); if (s === null || s === 0 || s === '0') return null; return s as number; }
function cleanArray(arr: unknown): string[] { if (!Array.isArray(arr)) return []; return arr.filter((v) => v !== null && v !== '') as string[]; }
function buildIntervals(d: Record<string, unknown>): { tokenMin: string; tokenGen: string; minSub: string | null; minUser: string | null } {
  return { tokenMin: sanitize(d.token_min_interval as never) !== null ? `${d.token_min_interval} seconds` : '0 seconds', tokenGen: sanitize(d.token_gen_interval as never) !== null ? `${d.token_gen_interval} minutes` : '30 minutes', minSub: sanitize(d.min_submission_interval as never) !== null && sanitize(d.min_submission_interval as never) !== 0 ? `${d.min_submission_interval} seconds` : null, minUser: sanitize(d.min_user_test_interval as never) !== null && sanitize(d.min_user_test_interval as never) !== 0 ? `${d.min_user_test_interval} seconds` : null };
}
async function insertTaskForApi(data: Record<string, unknown>): Promise<void> {
  const { tokenMin, tokenGen, minSub, minUser } = buildIntervals(data);
  await prisma.$executeRaw`INSERT INTO tasks (name, title, contest_id, num, submission_format, primary_statements, allowed_languages, token_mode, token_max_number, token_min_interval, token_gen_initial, token_gen_number, token_gen_interval, token_gen_max, max_submission_number, max_user_test_number, min_submission_interval, min_user_test_interval, feedback_level, score_precision, score_mode) VALUES (${data.name as string}, ${data.title as string}, ${sanitize(data.contest_id as never)}, null, ${cleanArray(data.submission_format).map((f: string) => f.replace(/%s/g, data.name as string))}::varchar[], ${cleanArray(data.primary_statements)}::varchar[], ${cleanArray(data.allowed_languages)}::varchar[], ${(data.token_mode as string) ?? 'disabled'}::token_mode, ${nullablePositive(data.token_max_number)}, ${tokenMin}::interval, ${(data.token_gen_initial as number) ?? 0}, ${(data.token_gen_number as number) ?? 0}, ${tokenGen}::interval, ${nullablePositive(data.token_gen_max)}, ${nullablePositive(data.max_submission_number)}, ${nullablePositive(data.max_user_test_number)}, ${minSub}::interval, ${minUser}::interval, ${(data.feedback_level as string) ?? 'restricted'}::feedback_level, ${(data.score_precision as number) ?? 0}, ${(data.score_mode as string) ?? 'max'}::score_mode)`;
}
export async function createTaskViaApi(data: Record<string, unknown>): Promise<MutationResult> {
  await requirePermission('task:create');
  const name = typeof data.name === 'string' ? data.name.trim() : ''; const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!name) { const e = new Error('Task name is required') as Error & { status: number }; e.status = 400; throw e; }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) { const e = new Error('Task name must contain only letters, numbers, hyphens and underscores') as Error & { status: number }; e.status = 400; throw e; }
  if (!title) { const e = new Error('Task title is required') as Error & { status: number }; e.status = 400; throw e; }
  if (data.contest_id !== undefined && data.contest_id !== null && data.contest_id !== '') { const cid = Number(data.contest_id); if (!Number.isInteger(cid) || cid <= 0) { const e = new Error('Contest identifier must be a positive integer') as Error & { status: number }; e.status = 400; throw e; } }
  try { await insertTaskForApi(data); await recordAudit({ verb: 'task:create', entity: 'task', afterValues: { name, title }, result: 'success' }); return { success: true }; } catch (e) { const msg = (e as Error).message; if (msg?.includes('unique constraint')) { const er = new Error('Task name already exists') as Error & { status: number }; er.status = 400; throw er; } throw e; }
}
function splitTaskData(data: Partial<TaskData>): { standardFields: Record<string, unknown>; intervalFields: Record<string, unknown> } {
  const sanitized: Record<string, unknown> = {}; for (const k in data) sanitized[k] = sanitize((data as Record<string, unknown>)[k] as never);
  const req = ['token_min_interval', 'token_gen_interval']; const opt = ['min_submission_interval', 'min_user_test_interval'];
  const nullable = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', ...opt];
  const std: Record<string, unknown> = {}; const iv: Record<string, unknown> = {};
  for (const k in sanitized) { if ([...req, ...opt].includes(k)) { if (req.includes(k) && sanitized[k] === null) continue; iv[k] = sanitized[k]; } else if (sanitized[k] !== null || nullable.includes(k)) std[k] = sanitized[k]; }
  return { standardFields: std, intervalFields: iv };
}
async function applyTaskIntervals(id: number, iv: Record<string, unknown>): Promise<void> {
  const clauses: string[] = []; const p: unknown[] = [];
  addIntervalClause(clauses, p, iv, 'token_min_interval', 'seconds'); addIntervalClause(clauses, p, iv, 'token_gen_interval', 'minutes');
  addIntervalClause(clauses, p, iv, 'min_submission_interval', 'seconds'); addIntervalClause(clauses, p, iv, 'min_user_test_interval', 'seconds');
  if (clauses.length === 0) return; p.push(id); await prisma.$executeRawUnsafe(`UPDATE tasks SET ${clauses.join(', ')} WHERE id = $${p.length}`, ...p);
}
export async function updateTask(id: number, data: Partial<TaskData>): Promise<MutationResult> {
  const perms = await requirePermission('task:update');
  const allowed = stripDisallowedFields('tasks', data as unknown as Record<string, unknown>, perms) as unknown as Partial<TaskData>;
  const s = allowed as unknown as Partial<TaskData>;
  try {
    const { standardFields, intervalFields } = splitTaskData(s);
    if (Object.keys(standardFields).length > 0) await prisma.tasks.update({ where: { id }, data: standardFields });
    if (Object.keys(intervalFields).length > 0) await applyTaskIntervals(id, intervalFields);
    await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(id), afterValues: s, result: 'success' });
    return { success: true };
  } catch (e) { const code = (e as { code?: string }).code; if (code === 'P2002') return { success: false, error: 'Task name already exists' }; return { success: false, error: e instanceof Error ? e.message : 'An unexpected error occurred' }; }
}
function sanitizeTaskDataForApi(raw: Record<string, unknown>): Record<string, unknown> { const s: Record<string, unknown> = {}; for (const k in raw) s[k] = sanitize(raw[k] as never); for (const k of ['max_submission_number', 'max_user_test_number', 'token_max_number', 'token_gen_max']) if (s[k] === 0 || s[k] === '0') s[k] = null; return s; }
async function normalizeSubmissionFormat(data: Record<string, unknown>, taskId: number): Promise<void> {
  if (!Array.isArray(data.submission_format)) return; data.submission_format = (data.submission_format as unknown[]).filter((v) => v !== null);
  if (!(data.submission_format as string[]).some((f) => f.includes('%s'))) return;
  let n = data.name as string | undefined; if (!n) { const ex = await prisma.tasks.findUnique({ where: { id: taskId }, select: { name: true } }); n = ex?.name ?? undefined; }
  if (n) data.submission_format = (data.submission_format as string[]).map((f) => f.replace(/%s/g, n as string));
}
function splitFieldsForApi(s: Record<string, unknown>): { standardFields: Record<string, unknown>; intervalFields: Record<string, unknown> } {
  const req = ['token_min_interval', 'token_gen_interval']; const opt = ['min_submission_interval', 'min_user_test_interval']; const arr = ['submission_format', 'primary_statements', 'allowed_languages'];
  const nullable = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', 'score_precision', ...opt];
  const std: Record<string, unknown> = {}; const iv: Record<string, unknown> = {};
  for (const k in s) { if ([...req, ...opt, ...arr].includes(k)) { if (req.includes(k) && s[k] === null) continue; iv[k] = s[k]; } else if (s[k] !== null || nullable.includes(k)) { if (s[k] === null && ['score_precision', 'token_gen_initial', 'token_gen_number'].includes(k)) std[k] = 0; else std[k] = s[k]; } }
  return { standardFields: std, intervalFields: iv };
}
async function applyTaskUpdatesForApi(id: number, std: Record<string, unknown>, iv: Record<string, unknown>): Promise<void> {
  if (Object.keys(std).length > 0) await prisma.tasks.update({ where: { id }, data: std }); if (Object.keys(iv).length === 0) return;
  const clauses: string[] = []; const q: unknown[] = [];
  addIntervalClause(clauses, q, iv, 'token_min_interval', 'seconds'); addIntervalClause(clauses, q, iv, 'token_gen_interval', 'minutes');
  addIntervalClause(clauses, q, iv, 'min_submission_interval', 'seconds'); addIntervalClause(clauses, q, iv, 'min_user_test_interval', 'seconds');
  if (iv.submission_format !== undefined) { q.push(iv.submission_format); clauses.push(`submission_format = $${q.length}::varchar[]`); }
  if (iv.primary_statements !== undefined) { q.push(iv.primary_statements); clauses.push(`primary_statements = $${q.length}::varchar[]`); }
  if (iv.allowed_languages !== undefined) { if (iv.allowed_languages === null) clauses.push(`allowed_languages = NULL`); else { q.push(iv.allowed_languages); clauses.push(`allowed_languages = $${q.length}::varchar[]`); } }
  if (clauses.length > 0) { q.push(id); await prisma.$executeRawUnsafe(`UPDATE tasks SET ${clauses.join(', ')} WHERE id = $${q.length}`, ...q); }
}
export async function updateTaskViaApi(id: number, raw: Record<string, unknown>): Promise<MutationResult> {
  await requirePermission('task:update'); if (Number.isNaN(id)) { const e = new Error('Invalid ID') as Error & { status: number }; e.status = 400; throw e; }
  const s = sanitizeTaskDataForApi(raw); await normalizeSubmissionFormat(s, id);
  const { standardFields, intervalFields } = splitFieldsForApi(s);
  try { await applyTaskUpdatesForApi(id, standardFields, intervalFields); await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(id), afterValues: { changedKeys: [...Object.keys(standardFields), ...Object.keys(intervalFields)] }, result: 'success' }); return { success: true }; } catch (e) { const code = (e as { code?: string }).code; if (code === 'P2002') { const er = new Error('Task name already exists') as Error & { status: number }; er.status = 400; throw er; } throw e; }
}
export async function deleteTask(id: number): Promise<MutationResult> {
  await requirePermission('task:delete'); const before = await prisma.tasks.findUnique({ where: { id } });
  try { await prisma.tasks.delete({ where: { id } }); await recordAudit({ verb: 'task:delete', entity: 'task', entityId: String(id), beforeValues: before ?? undefined, result: 'success' }); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; }
}
export async function deleteTaskViaApi(id: number): Promise<MutationResult> {
  await requirePermission('task:delete'); if (Number.isNaN(id)) { const e = new Error('Invalid ID') as Error & { status: number }; e.status = 400; throw e; }
  const before = await prisma.tasks.findUnique({ where: { id }, select: { name: true, title: true } });
  try { await prisma.tasks.delete({ where: { id } }); await recordAudit({ verb: 'task:delete', entity: 'task', entityId: String(id), beforeValues: before ? { name: before.name, title: before.title } : undefined, result: 'success' }); return { success: true }; } catch (e) { throw e; }
}
export async function assignTaskToContest(taskId: number, contestId: number | null): Promise<MutationResult> {
  await requirePermission('task:update');
  try { let num: number | null = null; if (contestId) { const m = await prisma.tasks.aggregate({ where: { contest_id: contestId }, _max: { num: true } }); num = (m._max.num ?? 0) + 1; } await prisma.tasks.update({ where: { id: taskId }, data: { contest_id: contestId, num } }); await recordAudit({ verb: 'task:update', entity: 'task', entityId: String(taskId), afterValues: { contest_id: contestId, num }, result: 'success' }); return { success: true }; } catch (e) { return { success: false, error: (e as Error).message }; }
}
