'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';
import { sanitize } from '@/lib/api-utils';
import { buildDiagnosticsForLoadedTask, computeTaskDiagnostics } from '@/lib/task-diagnostics';
import { addIntervalClause } from '@/lib/task-intervals';
import type { Prisma } from '@prisma/client';

const TASKS_PER_PAGE = 20;

export type { TaskDiagnostic } from '@/lib/task-diagnostics';

export async function getTasks({ page = 1, search = '' }: { page?: number; search?: string }): Promise<{
  tasks: Array<Prisma.tasksGetPayload<{ include: { contests: { select: { id: true; name: true } }; statements: { select: { id: true } }; datasets_datasets_task_idTotasks: { select: { id: true; description: true; _count: { select: { testcases: true } } } }; _count: { select: { submissions: true } } } }> & { diagnostics: ReturnType<typeof buildDiagnosticsForLoadedTask> }>;
  totalPages: number;
  total: number;
}> {
  await ensurePermission('tasks');
  const skip = (page - 1) * TASKS_PER_PAGE;
  const where: Prisma.tasksWhereInput = search
    ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { title: { contains: search, mode: 'insensitive' } }] }
    : {};
  const [rawTasks, total] = await Promise.all([
    prisma.tasks.findMany({
      where,
      skip,
      take: TASKS_PER_PAGE,
      orderBy: { id: 'desc' },
      include: {
        contests: { select: { id: true, name: true } },
        statements: { select: { id: true } },
        datasets_datasets_task_idTotasks: {
          select: { id: true, description: true, _count: { select: { testcases: true } } },
        },
        _count: { select: { submissions: true } },
      },
    }),
    prisma.tasks.count({ where }),
  ]);
  const tasksWithDiagnostics = rawTasks.map((task) => ({
    ...task,
    diagnostics: buildDiagnosticsForLoadedTask(task),
  }));
  return { tasks: tasksWithDiagnostics, totalPages: Math.ceil(total / TASKS_PER_PAGE), total };
}

export async function getTask(id: number): Promise<Prisma.tasksGetPayload<{ include: { contests: { select: { id: true; name: true; start: true; stop: true; analysis_start: true; analysis_stop: true } }; statements: { select: { id: true; language: true } }; attachments: true; datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true; codename: true } }; managers: true } }; _count: { select: { submissions: true } } } }> | null> {
  await ensurePermission('tasks');
  return prisma.tasks.findUnique({
    where: { id },
    include: {
      contests: { select: { id: true, name: true, start: true, stop: true, analysis_start: true, analysis_stop: true } },
      statements: { select: { id: true, language: true } },
      attachments: true,
      datasets_datasets_task_idTotasks: { include: { testcases: { select: { id: true, codename: true } }, managers: true } },
      _count: { select: { submissions: true } },
    },
  });
}

export async function getTaskDiagnostics(taskId: number): Promise<ReturnType<typeof computeTaskDiagnostics> extends Promise<infer T> ? T : never> {
  await ensurePermission('tasks');
  if (!taskId || Number.isNaN(taskId)) return [];
  return computeTaskDiagnostics(taskId);
}

export interface TaskData {
  name: string;
  title: string;
  contest_id?: number | null;
  score_mode?: string;
  feedback_level?: string;
  score_precision?: number | null;
  allowed_languages?: string[];
  submission_format?: string[];
  token_mode?: string;
  token_max_number?: number | null;
  token_min_interval?: number | null;
  token_gen_initial?: number | null;
  token_gen_number?: number | null;
  token_gen_interval?: number | null;
  token_gen_max?: number | null;
  max_submission_number?: number | null;
  max_user_test_number?: number | null;
  min_submission_interval?: number | null;
  min_user_test_interval?: number | null;
}

function toIntervalString(value: number | null, unit: string, fallback: string): string | null {
  if (value === null || value === undefined) return fallback;
  return `${value} ${unit}`;
}

export async function createTask(data: TaskData): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('tasks');
  try {
    const tokenMin = toIntervalString(sanitize(data.token_min_interval), 'seconds', '0 seconds') as string;
    const tokenGen = toIntervalString(sanitize(data.token_gen_interval), 'minutes', '30 minutes') as string;
    const minSub = toIntervalString(sanitize(data.min_submission_interval), 'seconds', '0 seconds') as string;
    const minUser = toIntervalString(sanitize(data.min_user_test_interval), 'seconds', '0 seconds') as string;
    await prisma.$executeRaw`
      INSERT INTO tasks (
        name, title, contest_id, num,
        submission_format, primary_statements, allowed_languages,
        token_mode, token_max_number, token_min_interval,
        token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
        max_submission_number, max_user_test_number,
        min_submission_interval, min_user_test_interval,
        feedback_level, score_precision, score_mode
      ) VALUES (
        ${data.name}, ${data.title}, ${sanitize(data.contest_id)}, null,
        ${data.submission_format ?? []}, ARRAY[]::varchar[], ${data.allowed_languages ?? []},
        ${data.token_mode ?? 'disabled'}::token_mode, ${sanitize(data.token_max_number)}, ${tokenMin}::interval,
        ${data.token_gen_initial ?? 0}, ${data.token_gen_number ?? 0}, ${tokenGen}::interval, ${sanitize(data.token_gen_max)},
        ${sanitize(data.max_submission_number)}, ${sanitize(data.max_user_test_number)},
        ${minSub}::interval, ${minUser}::interval,
        ${data.feedback_level ?? 'restricted'}::feedback_level, ${data.score_precision ?? 0}, ${data.score_mode ?? 'max'}::score_mode
      )
    `;
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('unique constraint')) return { success: false, error: 'Task name already exists' };
    return { success: false, error: message };
  }
}

function splitTaskData(data: Partial<TaskData>): { standardFields: Record<string, unknown>; intervalFields: Record<string, unknown> } {
  const sanitized: Record<string, unknown> = {};
  for (const key in data) sanitized[key] = sanitize((data as Record<string, unknown>)[key] as never);
  const requiredIntervals = ['token_min_interval', 'token_gen_interval'];
  const optionalIntervals = ['min_submission_interval', 'min_user_test_interval'];
  const nullableKeys = ['contest_id', 'token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number', ...optionalIntervals];
  const standardFields: Record<string, unknown> = {};
  const intervalFields: Record<string, unknown> = {};
  for (const key in sanitized) {
    if ([...requiredIntervals, ...optionalIntervals].includes(key)) {
      if (requiredIntervals.includes(key) && sanitized[key] === null) continue;
      intervalFields[key] = sanitized[key];
    } else if (sanitized[key] !== null || nullableKeys.includes(key)) {
      standardFields[key] = sanitized[key];
    }
  }
  return { standardFields, intervalFields };
}

async function applyTaskIntervals(id: number, intervalFields: Record<string, unknown>): Promise<void> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  addIntervalClause(setClauses, params, intervalFields, 'token_min_interval', 'seconds');
  addIntervalClause(setClauses, params, intervalFields, 'token_gen_interval', 'minutes');
  addIntervalClause(setClauses, params, intervalFields, 'min_submission_interval', 'seconds');
  addIntervalClause(setClauses, params, intervalFields, 'min_user_test_interval', 'seconds');
  if (setClauses.length === 0) return;
  params.push(id);
  await prisma.$executeRawUnsafe(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${params.length}`, ...params);
}

export async function updateTask(id: number, data: Partial<TaskData>): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('tasks');
  try {
    const { standardFields, intervalFields } = splitTaskData(data);
    if (Object.keys(standardFields).length > 0) await prisma.tasks.update({ where: { id }, data: standardFields });
    if (Object.keys(intervalFields).length > 0) await applyTaskIntervals(id, intervalFields);
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    console.error('Update Task Error:', error);
    const code = (error as { code?: string }).code;
    if (code === 'P2002') return { success: false, error: 'Task name already exists' };
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return { success: false, error: message };
  }
}

export async function deleteTask(id: number): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('tasks');
  try {
    await prisma.tasks.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function assignTaskToContest(taskId: number, contestId: number | null): Promise<{ success: boolean; error?: string }> {
  await ensurePermission('tasks');
  try {
    let num: number | null = null;
    if (contestId) {
      const maxNum = await prisma.tasks.aggregate({ where: { contest_id: contestId }, _max: { num: true } });
      num = (maxNum._max.num ?? 0) + 1;
    }
    await prisma.tasks.update({ where: { id: taskId }, data: { contest_id: contestId, num } });
    revalidatePath('/[locale]/tasks', 'page');
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
