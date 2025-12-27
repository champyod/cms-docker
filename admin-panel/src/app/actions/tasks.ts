'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

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

export async function createTask(data: {
  name: string;
  title: string;
  contest_id?: number | null;
}) {
  try {
    // Use raw SQL for interval fields
    await prisma.$executeRaw`
      INSERT INTO tasks (
        name, title, contest_id, num,
        submission_format, primary_statements, allowed_languages,
        token_mode, token_gen_initial, token_gen_number,
        token_min_interval, token_gen_interval,
        feedback_level, score_precision, score_mode
      ) VALUES (
        ${data.name}, ${data.title}, ${data.contest_id || null}, null,
        ARRAY[]::varchar[], ARRAY[]::varchar[], ARRAY[]::varchar[],
        'disabled', 2, 2,
        '0 seconds'::interval, '30 minutes'::interval,
        'restricted', 0, 'max'
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

export async function updateTask(id: number, data: {
  name?: string;
  title?: string;
  contest_id?: number | null;
  feedback_level?: string;
  score_precision?: number;
  score_mode?: string;
}) {
  try {
    await prisma.tasks.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.title && { title: data.title }),
        ...(data.contest_id !== undefined && { contest_id: data.contest_id }),
        ...(data.score_precision !== undefined && { score_precision: data.score_precision }),
      },
    });
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
    // Get max num for this contest if assigning
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
