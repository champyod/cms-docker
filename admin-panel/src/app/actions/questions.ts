'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Get questions for a contest
export async function getQuestions(contestId: number) {
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

// Reply to a question
export async function replyToQuestion(questionId: number, adminId: number, data: {
  reply_subject: string;
  reply_text: string;
}) {
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
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Ignore a question
export async function ignoreQuestion(questionId: number) {
  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: true }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Unignore a question
export async function unignoreQuestion(questionId: number) {
  try {
    await prisma.questions.update({
      where: { id: questionId },
      data: { ignored: false }
    });
    revalidatePath('/[locale]/contests');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getUnansweredQuestions(contestId: number | null) {
  const where: any = {
    reply_timestamp: null,
    ignored: false
  };

  if (contestId) {
    where.participations = { contest_id: contestId };
  }

  return prisma.questions.findMany({
    where,
    include: {
      participations: { include: { users: { select: { username: true } } } }
    },
    orderBy: { question_timestamp: 'desc' }
  });
}
