'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { tasks } from '@prisma/client';

const TASKS_PER_PAGE = 20;

export async function getTasks({ page = 1, search = '' }: { page?: number; search?: string }) {
  const skip = (page - 1) * TASKS_PER_PAGE;
  
  const where = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { title: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {};

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
          select: {
            id: true,
            description: true,
            _count: { select: { testcases: true } }
          }
        },
        _count: {
          select: { submissions: true }
        }
      }
    }),
    prisma.tasks.count({ where }),
  ]);

  // Calculate diagnostics for each task
  const tasksWithDiagnostics = rawTasks.map((task) => {
    const diagnostics: TaskDiagnostic[] = [];

    if (!task.active_dataset_id) {
      diagnostics.push({ type: 'error', message: 'No active dataset selected.' });
    } else {
      const activeDataset = task.datasets_datasets_task_idTotasks.find((d: any) => d.id === task.active_dataset_id);
      if (!activeDataset) {
        diagnostics.push({ type: 'error', message: 'Active dataset not found.' });
      } else if (activeDataset._count.testcases === 0) {
        diagnostics.push({ type: 'error', message: 'Active dataset has no test cases.' });
      }
    }

    if (task.statements.length === 0) {
      diagnostics.push({ type: 'error', message: 'No statements found.' });
    }

    if (!task.contest_id) {
      diagnostics.push({ type: 'warning', message: 'Not assigned to any contest.' });
    }

    return { ...task, diagnostics };
  });

  return {
    tasks: tasksWithDiagnostics,
    totalPages: Math.ceil(total / TASKS_PER_PAGE),
    total,
  };
}

export async function getTask(id: number) {
  return prisma.tasks.findUnique({
    where: { id },
    include: {
      contests: {
        select: {
          id: true,
          name: true,
          start: true,
          stop: true,
          analysis_start: true,
          analysis_stop: true
        }
      },
      statements: { select: { id: true, language: true } },
      attachments: true,
      datasets_datasets_task_idTotasks: {
        include: {
          testcases: { select: { id: true, codename: true } },
          managers: true,
        }
      },
      _count: {
        select: { submissions: true }
      }
    }
  });
}

export interface TaskDiagnostic {
  type: 'error' | 'warning';
  message: string;
}

export async function getTaskDiagnostics(taskId: number): Promise<TaskDiagnostic[]> {
  const task = await prisma.tasks.findUnique({
    where: { id: taskId },
    include: {
      statements: { select: { id: true } },
      datasets_datasets_task_idTotasks: {
        where: { id: { not: undefined } }, // Just to check if any exist
        include: { testcases: { select: { id: true } } }
      }
    }
  });

  if (!task) return [];

  const diagnostics: TaskDiagnostic[] = [];

  // Critical errors (unusable)
  if (!task.active_dataset_id) {
    diagnostics.push({ type: 'error', message: 'No active dataset selected. Task cannot be judged.' });
  }

  const activeDataset = task.active_dataset_id
    ? await prisma.datasets.findUnique({
      where: { id: task.active_dataset_id },
      include: { testcases: { select: { id: true } } }
    })
    : null;

  if (task.active_dataset_id && (!activeDataset?.testcases || activeDataset.testcases.length === 0)) {
    diagnostics.push({ type: 'error', message: 'Active dataset has no test cases.' });
  }

  if (task.statements.length === 0) {
    diagnostics.push({ type: 'error', message: 'No statements found. Users won\'t see instructions.' });
  }

  // Warnings
  if (!task.contest_id) {
    diagnostics.push({ type: 'warning', message: 'Not assigned to any contest.' });
  }

  return diagnostics;
}

export interface TaskData {
  name: string;
  title: string;
  contest_id?: number | null;
  score_mode?: string;
  feedback_level?: string;
  score_precision?: number;
  allowed_languages?: string[];
  submission_format?: string[];
  token_mode?: string;
  token_max_number?: number;
  token_min_interval?: number;
  token_gen_initial?: number;
  token_gen_number?: number;
  token_gen_interval?: number;
  token_gen_max?: number;
  max_submission_number?: number;
  max_user_test_number?: number;
  min_submission_interval?: number;
  min_user_test_interval?: number;
}

// Helper to sanitize Next.js Server Action serialization artifacts
function sanitize<T>(value: T | undefined | null): T | null {
  if (value === undefined || value === null || (value as any) === '$undefined') {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(v => (v === '$undefined' || v === '' ? null : v)) as unknown as T;
  }
  return value;
}

export async function createTask(data: TaskData): Promise<{ success: boolean; warning?: string | null; error?: string }> {
  try {
    const token_min_interval = sanitize(data.token_min_interval) !== null ? `${data.token_min_interval} seconds` : '0 seconds';
    const token_gen_interval = sanitize(data.token_gen_interval) !== null ? `${data.token_gen_interval} minutes` : '30 minutes';
    const min_submission_interval = sanitize(data.min_submission_interval) !== null ? `${data.min_submission_interval} seconds` : '0 seconds';
    const min_user_test_interval = sanitize(data.min_user_test_interval) !== null ? `${data.min_user_test_interval} seconds` : '0 seconds';

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
        ${data.submission_format || []}, ARRAY[]::varchar[], ${data.allowed_languages || []},
        ${data.token_mode || 'disabled'}::token_mode, ${sanitize(data.token_max_number)}, ${token_min_interval}::interval,
        ${data.token_gen_initial || 0}, ${data.token_gen_number || 0}, ${token_gen_interval}::interval, ${sanitize(data.token_gen_max)},
        ${sanitize(data.max_submission_number)}, ${sanitize(data.max_user_test_number)},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${data.feedback_level || 'restricted'}::feedback_level, ${data.score_precision || 0}, ${data.score_mode || 'max'}::score_mode
      )
    `;
    
    revalidatePath('/[locale]/tasks');

    let warning = null;
    if (!sanitize(data.contest_id)) {
      warning = "Task created but not assigned to any contest. It will also need a dataset to be usable.";
    } else {
      warning = "Task created. It will need a dataset to be usable.";
    }

    return { success: true, warning };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Task name already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateTask(id: number, data: Partial<TaskData>): Promise<{ success: boolean; diagnostics?: TaskDiagnostic[]; error?: string }> {
  try {
    // 1. Sanitize all incoming fields
    const sanitizedData: any = {};
    for (const key in data) {
      sanitizedData[key] = sanitize((data as any)[key]);
    }

    // 2. Prepare updates
    const standardFields: any = {};
    const intervalFields: any = {};

    // Defined in schema as NOT NULL
    const requiredIntervalKeys = [
      'token_min_interval',
      'token_gen_interval',
    ];

    // Defined in schema as NULLable
    const optionalIntervalKeys = [
      'min_submission_interval',
      'min_user_test_interval',
    ];

    const allIntervalKeys = [...requiredIntervalKeys, ...optionalIntervalKeys];

    // Fields that are allowed to be set to NULL in the database
    const nullableKeys = [
      'contest_id',
      'token_max_number',
      'token_gen_max',
      'max_submission_number',
      'max_user_test_number',
      ...optionalIntervalKeys
    ];

    for (const key in sanitizedData) {
      if (allIntervalKeys.includes(key)) {
        // If it's a required interval, only update if not null
        if (requiredIntervalKeys.includes(key)) {
          if (sanitizedData[key] !== null) {
            intervalFields[key] = sanitizedData[key];
          }
        } else {
          // It's an optional interval, always include (can be set to null)
          intervalFields[key] = sanitizedData[key];
        }
      } else {
        // Standard fields: include if not null OR if explicitly allowed to be null
        if (sanitizedData[key] !== null || nullableKeys.includes(key)) {
          standardFields[key] = sanitizedData[key];
        }
      }
    }

    // Perform updates if there are standard fields
    if (Object.keys(standardFields).length > 0) {
      await prisma.tasks.update({
        where: { id },
        data: standardFields,
      });
    }

    // 3. Update interval fields using raw SQL
    if (Object.keys(intervalFields).length > 0) {
      const setClauses: string[] = [];
      const params: any[] = [];

      const addIntervalClause = (key: string, unit: string) => {
        if (key in intervalFields) {
          if (intervalFields[key] === null) {
            setClauses.push(`${key} = NULL`);
          } else {
            params.push(`${intervalFields[key]} ${unit}`);
            setClauses.push(`${key} = $${params.length}::interval`);
          }
        }
      };

      addIntervalClause('token_min_interval', 'seconds');
      addIntervalClause('token_gen_interval', 'minutes');
      addIntervalClause('min_submission_interval', 'seconds');
      addIntervalClause('min_user_test_interval', 'seconds');

      if (setClauses.length > 0) {
        params.push(id);
        const query = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${params.length}`;
        await prisma.$executeRawUnsafe(query, ...params);
      }
    }

    const diagnostics = await getTaskDiagnostics(id);

    revalidatePath('/[locale]/tasks');
    revalidatePath(`/[locale]/tasks/${id}`);

    return { success: true, diagnostics };
  } catch (error) {
    const e = error as Error & { code?: string; meta?: any };
    console.error('Update Task Error:', e);

    if (e.code === 'P2002') {
      const target = e.meta?.target || [];
      if (target.includes('name')) return { success: false, error: 'Task name already exists' };
    }

    return { success: false, error: e.message || 'An unexpected error occurred during update' };
  }
}

export async function deleteTask(id: number) {
  try {
    await prisma.tasks.delete({ where: { id } });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function assignTaskToContest(taskId: number, contestId: number | null) {
  try {
    let num = null;
    if (contestId) {
      const maxNum = await prisma.tasks.aggregate({
        where: { contest_id: contestId },
        _max: { num: true }
      });
      num = (maxNum._max.num || 0) + 1;
    }
    
    await prisma.tasks.update({
      where: { id: taskId },
      data: { contest_id: contestId, num }
    });
    revalidatePath('/[locale]/tasks');
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
