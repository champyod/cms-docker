'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { safeUserSelect } from '@/lib/prisma-selects';
import { revalidatePath } from 'next/cache';

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
  await ensurePermission('contests');

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
          select: {
            score: true,
            dataset_id: true,
            compilation_outcome: true,
            evaluation_outcome: true,
            compilation_time: true,
            compilation_memory: true,
            compilation_text: true,
            compilation_stdout: true,
            compilation_stderr: true
          }
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
  await ensurePermission('contests');

    return prisma.submissions.findUnique({
        where: { id: submissionId },
        include: {
            tasks: true,
            participations: {
                include: {
                    users: { select: safeUserSelect },
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
    await ensurePermission('messaging');

    try {
        await prisma.submissions.update({
            where: { id: submissionId },
            data: { comment }
        });
        revalidatePath('/[locale]/submissions');
      return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
    }
}

// Toggle official status
export async function toggleSubmissionOfficial(submissionId: number) {
    await ensurePermission('contests');

    try {
        const sub = await prisma.submissions.findUnique({ where: { id: submissionId } });
        if (!sub) return { success: false, error: 'Submission not found' };

        await prisma.submissions.update({
            where: { id: submissionId },
            data: { official: !sub.official }
        });
        revalidatePath('/[locale]/submissions');
        return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
  }
}

// Recalculate a submission's score/evaluation
export async function recalculateSubmission(submissionId: number, type: 'score' | 'evaluation' | 'full' = 'score') {
  await ensurePermission('contests');

  try {
    // Get the submission with dataset info
    const submission = await prisma.submissions.findUnique({
      where: { id: submissionId },
      include: {
        tasks: { select: { active_dataset_id: true } },
        submission_results: { select: { dataset_id: true } }
      }
    });

    if (!submission) {
      return { success: false, error: 'Submission not found' };
    }

    const datasetId = submission.submission_results?.[0]?.dataset_id || submission.tasks?.active_dataset_id;

    // Determine RPC level (same mapping as before)
    const rpcLevel = type === 'full' ? 'compilation' : (type === 'evaluation' ? 'evaluation' : 'score');

    // RPC-FIRST: call EvaluationService before touching DB
    try {
      const response = await fetch('http://cms-admin-web-server:25000/rpc/EvaluationService/0/invalidate_submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: rpcLevel,
          submission_id: submissionId,
          dataset_id: datasetId
        })
      });

      if (!response.ok) {
        return { success: false, error: 'Resubmission failed: evaluation service did not accept the request' };
      }
    } catch (rpcError) {
      return { success: false, error: 'Resubmission failed: evaluation service did not accept the request' };
    }

    // ONLY if RPC succeeded: clear DB entries to mark for re-evaluation
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

    revalidatePath('/[locale]/submissions');
    return { success: true, message: 'Submission queued for recalculation' };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}
