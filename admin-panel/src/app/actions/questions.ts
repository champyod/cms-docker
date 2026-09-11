'use server'

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';

export async function getQuestions(contestId: number) {
  await ensurePermission('question:list');
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
  await ensurePermission('question:answer');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('questions', {
    reply_subject: data.reply_subject,
    reply_text: data.reply_text,
  }, permissions);
  if (allowed.reply_subject === undefined || allowed.reply_text === undefined) {
    return { success: false, error: 'Insufficient field permissions' };
  }

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: {
        admin_id: adminId,
        reply_subject: allowed.reply_subject,
        reply_text: allowed.reply_text,
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
  await ensurePermission('question:ignore');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('questions', { ignored: true }, permissions);
  if (allowed.ignored === undefined) {
    return { success: false, error: 'Insufficient permissions to update ignored field' };
  }

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: allowed.ignored }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function unignoreQuestion(questionId: number) {
  await ensurePermission('question:ignore');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('questions', { ignored: false }, permissions);
  if (allowed.ignored === undefined) {
    return { success: false, error: 'Insufficient permissions to update ignored field' };
  }

  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: allowed.ignored }
    });
    revalidatePath('/[locale]/contests', 'page');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getUnansweredQuestions(contestId: number | null) {
  await ensurePermission('question:list');
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
