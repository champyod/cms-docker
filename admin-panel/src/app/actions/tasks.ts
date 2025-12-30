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

  const [tasks, total] = await Promise.all([
    prisma.tasks.findMany({
      where,
      skip,
      take: TASKS_PER_PAGE,
      orderBy: { id: 'desc' },
      include: {
        contests: { select: { id: true, name: true } },
        statements: true,
        datasets_datasets_task_idTotasks: {
          select: { id: true, description: true }
        },
        _count: {
          select: { submissions: true }
        }
      }
    }),
    prisma.tasks.count({ where }),
  ]);

  return {
    tasks,
    totalPages: Math.ceil(total / TASKS_PER_PAGE),
    total,
  };
}

export async function getTask(id: number) {
  return prisma.tasks.findUnique({
    where: { id },
    include: {
      contests: true,
      statements: true,
      attachments: true,
      datasets_datasets_task_idTotasks: {
        include: {
          testcases: { orderBy: { codename: 'asc' } },
          managers: true,
        }
      },
      _count: {
        select: { submissions: true }
      }
    }
  });
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

export async function createTask(data: TaskData) {
  try {
    const token_min_interval = `${data.token_min_interval || 0} seconds`;
    const token_gen_interval = `${data.token_gen_interval || 30} minutes`;
    const min_submission_interval = `${data.min_submission_interval || 0} seconds`;
    const min_user_test_interval = `${data.min_user_test_interval || 0} seconds`;

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
        ${data.name}, ${data.title}, ${data.contest_id || null}, null,
        ${data.submission_format || []}, ARRAY[]::varchar[], ${data.allowed_languages || []},
        ${data.token_mode || 'disabled'}::token_mode, ${data.token_max_number ?? null}, ${token_min_interval}::interval,
        ${data.token_gen_initial || 0}, ${data.token_gen_number || 0}, ${token_gen_interval}::interval, ${data.token_gen_max ?? null},
        ${data.max_submission_number ?? null}, ${data.max_user_test_number ?? null},
        ${min_submission_interval}::interval, ${min_user_test_interval}::interval,
        ${data.feedback_level || 'restricted'}::feedback_level, ${data.score_precision || 0}, ${data.score_mode || 'max'}::score_mode
      )
    `;
    
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error & { code?: string };
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: 'Task name already exists' };
    }
    return { success: false, error: e.message };
  }
}

export async function updateTask(id: number, data: Partial<TaskData>) {
  try {
    const token_min_interval = data.token_min_interval !== undefined ? `${data.token_min_interval} seconds` : null;
    const token_gen_interval = data.token_gen_interval !== undefined ? `${data.token_gen_interval} minutes` : null;
    const min_submission_interval = data.min_submission_interval !== undefined ? `${data.min_submission_interval} seconds` : null;
    const min_user_test_interval = data.min_user_test_interval !== undefined ? `${data.min_user_test_interval} seconds` : null;

    await prisma.$executeRaw`
      UPDATE tasks SET
        name = COALESCE(${data.name}, name),
        title = COALESCE(${data.title}, title),
        contest_id = COALESCE(${data.contest_id}, contest_id),
        allowed_languages = COALESCE(${data.allowed_languages}, allowed_languages),
        submission_format = COALESCE(${data.submission_format}, submission_format),
        
        score_precision = COALESCE(${data.score_precision}, score_precision),
        score_mode = COALESCE(${data.score_mode}::score_mode, score_mode),
        feedback_level = COALESCE(${data.feedback_level}::feedback_level, feedback_level),

        token_mode = COALESCE(${data.token_mode}::token_mode, token_mode),
        token_max_number = COALESCE(${data.token_max_number}, token_max_number),
        token_gen_initial = COALESCE(${data.token_gen_initial}, token_gen_initial),
        token_gen_number = COALESCE(${data.token_gen_number}, token_gen_number),
        token_gen_max = COALESCE(${data.token_gen_max}, token_gen_max),

        max_submission_number = COALESCE(${data.max_submission_number}, max_submission_number),
        max_user_test_number = COALESCE(${data.max_user_test_number}, max_user_test_number),

        token_min_interval = CASE WHEN ${token_min_interval}::text IS NOT NULL THEN ${token_min_interval}::interval ELSE token_min_interval END,
        token_gen_interval = CASE WHEN ${token_gen_interval}::text IS NOT NULL THEN ${token_gen_interval}::interval ELSE token_gen_interval END,
        min_submission_interval = CASE WHEN ${min_submission_interval}::text IS NOT NULL THEN ${min_submission_interval}::interval ELSE min_submission_interval END,
        min_user_test_interval = CASE WHEN ${min_user_test_interval}::text IS NOT NULL THEN ${min_user_test_interval}::interval ELSE min_user_test_interval END
      WHERE id = ${id}
    `;

    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
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
