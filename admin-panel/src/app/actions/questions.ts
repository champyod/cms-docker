'use server'

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { ensurePermission } from '@/lib/permissions';

export async function getQuestions(contestId: number) {
  await ensurePermission('contests');
  return prisma.questions.findMany({
    where: { 
      participations: { contest_id: contestId }
    },
    include: { 
      admins: { select: { username: true } },
      participations: { include: { users: { select: { username: true } } } }
    },
    orderBy: { question_timestamp: 'desc' }
  });
}

export async function replyToQuestion(questionId: number, adminId: number, data: {
  reply_subject: string;
  reply_text: string;
}) {
  await ensurePermission('contests');

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: {
        admin_id: adminId,
        reply_subject: data.reply_subject,
        reply_text: data.reply_text,
        reply_timestamp: new Date(),
        ignored: false,
      }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function ignoreQuestion(questionId: number) {
  await ensurePermission('contests');

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: true }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function unignoreQuestion(questionId: number) {
  await ensurePermission('contests');

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: false }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getUnansweredQuestions(contestId: number | null) {
  await ensurePermission('contests');
  const where: Record<string, unknown> = {
    reply_timestamp: null,
    ignored: false
  };

  if (contestId) {
    where.participations = { contest_id: contestId };
  }

  return prisma.questions.findMany({
    where: where as Prisma.questionsWhereInput,
    include: {
      participations: { include: { users: { select: { username: true } } } }
    },
    orderBy: { question_timestamp: 'desc' }
  });
}
