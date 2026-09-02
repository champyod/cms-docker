'use server'

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { submissionsListInclude } from '@/lib/prisma-selects';
import { revalidatePath } from 'next/cache';

const SUBMISSIONS_PER_PAGE = 20;
const EVALUATION_RPC_ENDPOINT = 'http://cms-admin-web-server:25000/rpc/EvaluationService/0/invalidate_submission';

interface ActionResult {
  success: boolean;
  error?: string;
}

type RecalcType = 'score' | 'evaluation' | 'full';

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
  const where = buildSubmissionsWhere({ contestId, taskId, userId });

  const [submissions, total] = await Promise.all([
    prisma.submissions.findMany({
      where,
      skip,
      take: SUBMISSIONS_PER_PAGE,
      orderBy: { timestamp: 'desc' },
      include: submissionsListInclude,
    }),
    prisma.submissions.count({ where }),
  ]);

  return {
      submissions,
    totalPages: Math.ceil(total / SUBMISSIONS_PER_PAGE),
    total,
  };
}

function buildSubmissionsWhere(filters: { contestId?: number; taskId?: number; userId?: number }): Prisma.submissionsWhereInput {
  const participations: Record<string, unknown> = {};
  if (filters.contestId) {
    participations.contest_id = filters.contestId;
  }
  if (filters.userId) {
    participations.user_id = filters.userId;
  }

  const where: Prisma.submissionsWhereInput = {};
  if (filters.taskId) {
    where.task_id = filters.taskId;
  }
  if (Object.keys(participations).length > 0) {
    where.participations = participations as Prisma.submissionsWhereInput['participations'];
  }
  return where;
}

export async function updateSubmissionComment(submissionId: number, comment: string): Promise<ActionResult> {
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

export async function toggleSubmissionOfficial(submissionId: number): Promise<ActionResult> {
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

export async function recalculateSubmission(submissionId: number, type: RecalcType = 'score'): Promise<ActionResult & { message?: string }> {
  await ensurePermission('contests');

  try {
    const context = await getRecalcContext(submissionId);
    if (!context) {
      return { success: false, error: 'Submission not found' };
    }

    const accepted = await invalidateViaRpc(submissionId, context.datasetId, rpcLevelFor(type));
    if (!accepted) {
      return { success: false, error: 'Resubmission failed: evaluation service did not accept the request' };
    }

    await clearRecalculatedTables(submissionId, type);

    revalidatePath('/[locale]/submissions');
    return { success: true, message: 'Submission queued for recalculation' };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

async function getRecalcContext(submissionId: number): Promise<{ datasetId: number | null } | null> {
  const submission = await prisma.submissions.findUnique({
    where: { id: submissionId },
    include: {
      tasks: { select: { active_dataset_id: true } },
      submission_results: { select: { dataset_id: true } }
    }
  });

  if (!submission) return null;

  return { datasetId: submission.submission_results?.[0]?.dataset_id || submission.tasks?.active_dataset_id };
}

function rpcLevelFor(type: RecalcType): string {
  return type === 'full' ? 'compilation' : (type === 'evaluation' ? 'evaluation' : 'score');
}

async function invalidateViaRpc(submissionId: number, datasetId: number | null, level: string): Promise<boolean> {
  try {
    const response = await fetch(EVALUATION_RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        submission_id: submissionId,
        dataset_id: datasetId
      })
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function clearRecalculatedTables(submissionId: number, type: RecalcType): Promise<void> {
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
}
