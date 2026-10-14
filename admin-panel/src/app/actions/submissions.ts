'use server'

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
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

/**
 * How many submissions one batch requeue will touch.
 *
 * WHY a cap at all: a filter of "everything" on a finished contest would otherwise
 * requeue thousands of submissions from one click, each with a 10s RPC budget, and the
 * operator would have no idea what they had set in motion. WHY 200: it covers re-scoring
 * one task in a normal round, which is the case this exists for, while keeping the
 * sequential cost bounded.
 */
const BATCH_RECALC_LIMIT = 200;

/** The narrowing a batch operates on; every field absent means the whole deployment. */
export interface BatchRecalcScope {
  readonly contestId?: number;
  readonly taskId?: number;
  readonly userId?: number;
}

/** What a batch would do, computed without changing anything. */
export interface BatchRecalcPreview {
  readonly matched: number;
  readonly willProcess: number;
  readonly capped: boolean;
}

export interface BatchRecalcOutcome {
  readonly submissionId: number;
  readonly ok: boolean;
  readonly error?: string;
}

export interface BatchRecalcReport {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly capped: boolean;
  readonly outcomes: readonly BatchRecalcOutcome[];
}

/**
 * The single permission gate for requeueing, shared by the single and batch paths so the
 * two cannot drift into different requirements.
 */
async function ensureRecalcPermissions(): Promise<void> {
  await ensurePermission('submission:recompute');
  // Why also rejudge and both deletes: requeueing discards the old rows as well as
  // asking for new ones, so it needs the right to do each half.
  await ensurePermission('submission:rejudge');
  await ensurePermission('evaluation:delete');
  await ensurePermission('submissionresult:delete');
}

/** The where clause a batch scope describes, shared by the preview and the run. */
function batchWhere(scope: BatchRecalcScope): Prisma.submissionsWhereInput {
  const participations: Record<string, number> = {
    ...(scope.contestId === undefined ? {} : { contest_id: scope.contestId }),
    ...(scope.userId === undefined ? {} : { user_id: scope.userId }),
  };
  return {
    ...(scope.taskId === undefined ? {} : { task_id: scope.taskId }),
    ...(Object.keys(participations).length === 0
      ? {}
      : { participations: participations as Prisma.submissionsWhereInput['participations'] }),
  };
}

/**
 * What the scope would requeue, without requeueing it.
 *
 * WHY this is a separate call and not part of the run: "I re-ran the whole contest by
 * accident" is the failure this feature can most easily cause, and a count plus the cap
 * is what lets an operator notice the filter is wider than they meant before committing.
 */
export async function previewBatchRecalculation(
  scope: BatchRecalcScope,
): Promise<BatchRecalcPreview> {
  await ensureRecalcPermissions();
  const matched = await prisma.submissions.count({ where: batchWhere(scope) });
  return {
    matched,
    willProcess: Math.min(matched, BATCH_RECALC_LIMIT),
    capped: matched > BATCH_RECALC_LIMIT,
  };
}

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
    await ensureRecalcPermissions();
    const failure = await requeueOne(submissionId, type);
    if (failure !== null) return { success: false, error: failure };
    return { success: true, message: 'Submission queued for recalculation' };
  } catch (error) {
    // Why rethrow: redirect() signals login expiry by throwing NEXT_REDIRECT; swallowing it would trade the login bounce for an opaque toast.
    const digest = (error as { digest?: string }).digest;
    if (digest?.startsWith('NEXT_REDIRECT')) throw error;
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

/**
 * Requeue one submission, returning null on success or the reason it failed.
 *
 * WHY this is extracted: the batch path must do exactly what the single path does —
 * same RPC, same table clearing, same audit row, same revalidation — and the only way to
 * guarantee that is for both to call this. A second copy would drift.
 *
 * WHY it does not gate permissions: the caller does, once, so a batch of 200 performs
 * four permission reads rather than eight hundred.
 */
async function requeueOne(submissionId: number, type: RecalcType): Promise<string | null> {
  const context = await getRecalcContext(submissionId);
  if (!context) return 'Submission not found';

  const rpcResult = await invalidateViaRpc(submissionId, context.datasetId, rpcLevelFor(type), context.contestId);
  if (rpcResult.timedOut) return 'Evaluation service did not respond in time';
  if (!rpcResult.accepted) return 'Resubmission failed: evaluation service did not accept the request';

  await clearRecalculatedTables(submissionId, type);

  await recordAudit({
    verb: 'submission:recompute',
    entity: 'submission',
    entityId: String(submissionId),
    afterValues: { type },
    result: 'success',
  });
  return null;
}

/** The scope as a stable audit label, e.g. `contest=3 task=5`. */
function batchScopeLabel(scope: BatchRecalcScope): string {
  const parts = [
    scope.contestId === undefined ? null : `contest=${scope.contestId}`,
    scope.taskId === undefined ? null : `task=${scope.taskId}`,
    scope.userId === undefined ? null : `user=${scope.userId}`,
  ].filter((part): part is string => part !== null);
  // Why an explicit "all": an empty label would make an unscoped batch look like a
  // malformed row rather than the widest possible action.
  return parts.length === 0 ? 'all' : parts.join(' ');
}

/**
 * Requeue every submission a scope matches, up to the cap.
 *
 * WHY sequential and not concurrent: the evaluation service takes one submission per
 * RPC over a single connection, and firing hundreds at once would turn a deliberate
 * requeue into a queue spike. Sequential also means the outcomes list is ordered and a
 * partial failure is readable.
 *
 * WHY per-item outcomes rather than a bare count: a batch that reports "38 of 200"
 * without saying which 162 failed is not actionable. Each failure carries its reason.
 */
export async function recalculateSubmissions(
  scope: BatchRecalcScope,
  type: RecalcType = 'score',
): Promise<BatchRecalcReport> {
  await ensureRecalcPermissions();

  const matched = await prisma.submissions.findMany({
    where: batchWhere(scope),
    orderBy: { id: 'asc' },
    take: BATCH_RECALC_LIMIT,
    select: { id: true },
  });

  const outcomes: BatchRecalcOutcome[] = [];
  for (const submission of matched) {
    // Why a per-item guard: one submission whose RPC times out must not abandon the rest
    // of the batch, so a thrown error becomes this item's outcome.
    let reason: string | null;
    try {
      reason = await requeueOne(submission.id, type);
    } catch (error) {
      reason = (error as Error).message;
    }
    outcomes.push(
      reason === null
        ? { submissionId: submission.id, ok: true }
        : { submissionId: submission.id, ok: false, error: reason },
    );  }

  const succeeded = outcomes.filter((outcome) => outcome.ok).length;
  // Why one audit row for the batch rather than relying on the per-item rows: the
  // question "who asked for this?" is about the batch, and answering it from 200 rows
  // would mean reconstructing the grouping afterwards. The per-item rows stay, so the
  // submission's own history is still complete.
  await recordAudit({
    verb: 'submission:recompute',
    // Why a scope string and not the submission id: this row describes a batch, not one
    // submission, and the per-item rows already carry their own ids. Putting a single id
    // here would make the batch row read as if it were about that one submission.
    entityId: batchScopeLabel(scope),
    entity: 'submission',
    afterValues: {
      type,
      scope,
      processed: outcomes.length,
      succeeded,
      failed: outcomes.length - succeeded,
    },
    result: 'success',
  });
  revalidateSubmissionSurfaces();

  return {
    processed: outcomes.length,
    succeeded,
    failed: outcomes.length - succeeded,
    capped: matched.length === BATCH_RECALC_LIMIT,
    outcomes,
  };
}

async function getRecalcContext(
  submissionId: number
): Promise<{ datasetId: number | null; contestId: number | null } | null> {
  const submission = await prisma.submissions.findUnique({
    where: { id: submissionId },
    include: {
      tasks: { select: { active_dataset_id: true, contest_id: true } },
      submission_results: { select: { dataset_id: true } }
    }
  });

  if (!submission) return null;

  return {
    datasetId: submission.submission_results?.[0]?.dataset_id || submission.tasks?.active_dataset_id,
    contestId: submission.tasks?.contest_id ?? null,
  };
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
