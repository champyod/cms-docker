'use server'

import { prisma } from '@/lib/prisma';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields, getFieldAccess, type FieldAccess } from '@/lib/field-permissions';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { invalidateViaRpc } from '@/lib/evaluation-rpc';

interface ActionResult {
  success: boolean;
  error?: string;
}

type RecalcType = 'score' | 'evaluation' | 'full';

export async function updateSubmissionComment(submissionId: number, comment: string): Promise<ActionResult> {
    await ensurePermission('submission:update');

    try {
        const effectivePermissions = await getPermissions();
        const allowed = stripDisallowedFields('submissions', { comment }, effectivePermissions);
        if (!('comment' in allowed)) {
            return { success: false, error: 'Permission denied for comment field' };
        }

        await prisma.submissions.update({
            where: { id: submissionId },
            data: { comment: allowed.comment as string }
        });
        await recordAudit({
          verb: 'submission:update',
          entity: 'submission',
          entityId: String(submissionId),
          afterValues: { comment: allowed.comment },
          result: 'success',
        });
        revalidateSubmissionSurfaces();
      return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
    }
}

export async function toggleSubmissionOfficial(submissionId: number): Promise<ActionResult> {
    await ensurePermission('submission:update');

    try {
        const effectivePermissions = await getPermissions();
        const allowed = stripDisallowedFields('submissions', { official: true }, effectivePermissions);
        if (!('official' in allowed)) {
            return { success: false, error: 'Permission denied for official field' };
        }

        const sub = await prisma.submissions.findUnique({ where: { id: submissionId } });
        if (!sub) return { success: false, error: 'Submission not found' };

        await prisma.submissions.update({
            where: { id: submissionId },
            data: { official: !sub.official }
        });
        await recordAudit({
          verb: 'submission:update',
          entity: 'submission',
          entityId: String(submissionId),
          beforeValues: { official: sub.official },
          afterValues: { official: !sub.official },
          result: 'success',
        });
        revalidateSubmissionSurfaces();
        return { success: true };
  } catch (error) {
      const e = error as Error;
      return { success: false, error: e.message };
   }
}

export async function recalculateSubmission(submissionId: number, type: RecalcType = 'score'): Promise<ActionResult & { message?: string }> {
  try {
    await ensurePermission('submission:recompute');
    // Why gates inside try: requeueing needs rejudge plus delete rights on both cleared tables, and a denial must return a failure, never a digest.
    await ensurePermission('submission:rejudge');
    await ensurePermission('evaluation:delete');
    await ensurePermission('submissionresult:delete');

    const context = await getRecalcContext(submissionId);
    if (!context) {
      return { success: false, error: 'Submission not found' };
    }

    const rpcResult = await invalidateViaRpc(submissionId, context.datasetId, rpcLevelFor(type));
    if (rpcResult.timedOut) {
      return { success: false, error: 'Evaluation service did not respond in time' };
    }
    if (!rpcResult.accepted) {
      return { success: false, error: 'Resubmission failed: evaluation service did not accept the request' };
    }

    await clearRecalculatedTables(submissionId, type);

    await recordAudit({
      verb: 'submission:recompute',
      entity: 'submission',
      entityId: String(submissionId),
      afterValues: { type },
      result: 'success',
    });
    revalidateSubmissionSurfaces();
    return { success: true, message: 'Submission queued for recalculation' };
  } catch (error) {
    // Why rethrow: redirect() signals login expiry by throwing NEXT_REDIRECT; swallowing it would trade the login bounce for an opaque toast.
    const digest = (error as { digest?: string }).digest;
    if (digest?.startsWith('NEXT_REDIRECT')) throw error;
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

// Why the list path and the record path: a write here changes the list row and
// the record landing page, and a `page`-typed revalidatePath on the record path is
// a working invalidation for that page. It does not invalidate the pages beneath
// it, and the four tabs sit beneath `/[id]`, so an open tab is refreshed by the
// caller's client-side router.refresh() once the action succeeds.
function revalidateSubmissionSurfaces(): void {
  revalidatePath('/[locale]/evaluation/submissions', 'page');
  revalidatePath('/[locale]/evaluation/submissions/[id]', 'page');
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

/** Returns per-field read/update booleans for the submissions entity based on the current user's permissions. */
export async function getSubmissionFieldAccess(): Promise<Record<string, FieldAccess>> {
  const effectivePermissions = await getPermissions();
  return getFieldAccess('submissions', effectivePermissions);
}
