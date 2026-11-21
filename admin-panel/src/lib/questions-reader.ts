import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { QuestionsFrame, UnansweredQuestion } from '@/lib/live/frames';

/** What the header's dot counts and what it alerts on. */
const UNANSWERED_QUESTIONS: Prisma.questionsWhereInput = {
  reply_timestamp: null,
  ignored: false,
};

function toSummary(row: {
  id: number;
  subject: string;
  question_timestamp: Date;
  participations: { users: { username: string } };
}): UnansweredQuestion {
  return {
    id: row.id,
    subject: row.subject,
    username: row.participations.users.username,
    askedAt: row.question_timestamp.toISOString(),
  };
}

/**
 * The unanswered-question state the header streams and its dot reads.
 *
 * Why one query for both answers: the dot needs the count and the alert needs the newest row, and a
 * reader that asked twice would describe the same questions from two moments.
 */
export async function readUnansweredQuestions(): Promise<QuestionsFrame> {
  const [unansweredCount, newest] = await Promise.all([
    prisma.questions.count({ where: UNANSWERED_QUESTIONS }),
    prisma.questions.findFirst({
      where: UNANSWERED_QUESTIONS,
      orderBy: { question_timestamp: 'desc' },
      include: { participations: { include: { users: { select: { username: true } } } } },
    }),
  ]);

  return { unansweredCount, latest: newest === null ? null : toSummary(newest) };
}
