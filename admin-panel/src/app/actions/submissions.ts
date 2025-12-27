'use server'

import { prisma } from '@/lib/prisma';

const SUBMISSIONS_PER_PAGE = 20;

// Get submissions with pagination and filters
export async function getSubmissions({
    page = 1,
  contestId,
  taskId,
    userId,
}: {
    page?: number;
  contestId?: number;
  taskId?: number;
  userId?: number;
}) {
  const skip = (page - 1) * SUBMISSIONS_PER_PAGE;
  
    const where: any = {};
    if (contestId) {
        where.participations = { contest_id: contestId };
    }
    if (taskId) {
        where.task_id = taskId;
  }
    if (userId) {
        where.participations = { ...where.participations, user_id: userId };
  }

  const [submissions, total] = await Promise.all([
    prisma.submissions.findMany({
      where,
      skip,
      take: SUBMISSIONS_PER_PAGE,
      orderBy: { timestamp: 'desc' },
      include: {
          tasks: { select: { id: true, name: true, title: true } },
        participations: {
            include: {
                users: { select: { username: true } },
                contests: { select: { name: true } }
            }
          },
        submission_results: {
          select: { score: true, dataset_id: true, compilation_outcome: true, evaluation_outcome: true }
          },
          files: { select: { filename: true, digest: true } }
      }
    }),
    prisma.submissions.count({ where }),
  ]);

  return {
      submissions,
    totalPages: Math.ceil(total / SUBMISSIONS_PER_PAGE),
    total,
  };
}

// Get a single submission with full details
export async function getSubmission(submissionId: number) {
    return prisma.submissions.findUnique({
        where: { id: submissionId },
        include: {
            tasks: true,
            participations: {
                include: {
                    users: true,
                    contests: true
        }
        },
        submission_results: {
            include: { datasets: true }
        },
        files: true,
        evaluations: {
            include: { testcases: true },
            orderBy: { id: 'asc' }
        }
      }
  });
}

// Update submission comment
export async function updateSubmissionComment(submissionId: number, comment: string) {
    try {
        await prisma.submissions.update({
            where: { id: submissionId },
            data: { comment }
        });
      return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
    }
}

// Toggle official status
export async function toggleSubmissionOfficial(submissionId: number) {
    try {
        const sub = await prisma.submissions.findUnique({ where: { id: submissionId } });
        if (!sub) return { success: false, error: 'Submission not found' };

        await prisma.submissions.update({
            where: { id: submissionId },
            data: { official: !sub.official }
        });
        return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
  }
}

// Recalculate a submission's score/evaluation
export async function recalculateSubmission(submissionId: number, type: 'score' | 'evaluation' | 'full' = 'score') {
  try {
    // Get the submission
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      include: { tasks: { select: { active_dataset_id: true } } }
    });

    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    // For now, we just mark evaluations for re-evaluation by clearing them
    // The actual re-evaluation is done by the CMS EvaluationService
    if (type === 'evaluation' || type === 'full') {
      await prisma.evaluations.deleteMany({
        where: { submission_id: submissionId }
      });
    }

    if (type === 'score' || type === 'full') {
      await prisma.submission_results.deleteMany({
        where: { submission_id: submissionId }
      });
    }

    return { success: true, message: 'Submission queued for recalculation' };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
