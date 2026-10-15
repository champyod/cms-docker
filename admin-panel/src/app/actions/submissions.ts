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

export type RecalcType = 'score' | 'evaluation' | 'full';

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

const RECALC_REASON_REQUIRED = 'A reason is required for every recalculation';

/** The justification a requeue runs with; the reason is required for every kind. */
export interface RecalcOptions {
  readonly reason: string;
  readonly datasetId?: number;
}

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
  readonly limit: number;
}

export interface BatchRecalcOutcome {
  readonly submissionId: number;
  readonly ok: boolean;
  readonly error?: string;
  readonly datasetId?: number | null;
  readonly timedOut?: boolean;
}

export interface BatchRecalcReport {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly capped: boolean;
  readonly outcomes: readonly BatchRecalcOutcome[];
  readonly error?: string;
}

interface BatchRun {
  readonly ids: readonly number[];
  readonly type: RecalcType;
  readonly options: RecalcOptions;
  readonly auditEntityId: string;
  readonly auditValues: Readonly<Record<string, unknown>>;
  readonly capped: boolean;
}

type RequeueOutcome =
  | { readonly ok: true; readonly datasetId: number | null }
  | { readonly ok: false; readonly error: string; readonly timedOut?: boolean };

interface RecalcContext {
  readonly datasetId: number | null;
  readonly contestId: number | null;
}

type RecalcResolution =
  | { readonly context?: undefined; readonly error: string }
  | { readonly context: RecalcContext; readonly error?: undefined };

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
  return previewOf(matched);
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

export async function toggleSubmissionOfficial(submissionId: number, reason?: string): Promise<ActionResult> {
    await ensurePermission('submission:update');

    try {
        const effectivePermissions = await getPermissions();
        const allowed = stripDisallowedFields('submissions', { official: true }, effectivePermissions);
        if (!('official' in allowed)) {
            return { success: false, error: 'Permission denied for official field' };
        }

        return await flipOfficialFlag(submissionId, reason);
    } catch (error) {
        const e = error as Error;
        return { success: false, error: e.message };
    }
}

/**
 * Flips the flag against the value that was read, so a second tab acting on the
 * same row finds no matching row instead of flipping the flag twice.
 */
async function flipOfficialFlag(submissionId: number, reason?: string): Promise<ActionResult> {
    const sub = await prisma.submissions.findUnique({
        where: { id: submissionId },
        select: { official: true },
    });
    if (!sub) return { success: false, error: 'Submission not found' };

    const next = !sub.official;
    const updated = await prisma.submissions.updateMany({
        where: { id: submissionId, official: sub.official },
        data: { official: next },
    });
    if (updated.count === 0) {
        return { success: false, error: 'Submission was changed elsewhere; refresh and try again' };
    }

    await recordOfficialToggle(submissionId, sub.official, next, reason);
    revalidateSubmissionSurfaces();
    return { success: true };
}

async function recordOfficialToggle(
    submissionId: number,
    previous: boolean,
    next: boolean,
    reason?: string,
): Promise<void> {
    const trimmed = reason?.trim() ?? '';
    await recordAudit({
      verb: 'submission:update',
      entity: 'submission',
      entityId: String(submissionId),
      beforeValues: { official: previous },
      afterValues: trimmed === '' ? { official: next } : { official: next, reason: trimmed },
      ...(trimmed === '' ? {} : { reason: trimmed }),
      result: 'success',
    });
}

/**
 * Sets the official flag on a selection; it sets rather than toggles because a mixed
 * selection has no single correct flip. Every row is written with the same conditional
 * guard as the single toggle, so a stale selection cannot flip rows twice.
 */
export async function setSubmissionOfficial(
  ids: readonly number[],
  official: boolean,
  reason?: string,
): Promise<ActionResult & { updated: number }> {
  await ensurePermission('submission:update');

  try {
    const effectivePermissions = await getPermissions();
    const allowed = stripDisallowedFields('submissions', { official: true }, effectivePermissions);
    if (!('official' in allowed)) {
      return { success: false, error: 'Permission denied for official field', updated: 0 };
    }

    const selection = uniqueIds(ids);
    if (selection.length === 0) return { success: true, updated: 0 };

    const updated = await setOfficialOnIds(selection, official, reason);
    if (updated > 0) {
      await recordOfficialBatch(selection, official, updated, reason);
      revalidateSubmissionSurfaces();
    }
    return { success: true, updated };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message, updated: 0 };
  }
}

async function setOfficialOnIds(
  ids: readonly number[],
  official: boolean,
  reason?: string,
): Promise<number> {
  let updated = 0;
  for (const submissionId of ids) {
    const result = await prisma.submissions.updateMany({
      where: { id: submissionId, official: !official },
      data: { official },
    });
    if (result.count > 0) {
      updated += 1;
      await recordOfficialToggle(submissionId, !official, official, reason);
    }
  }
  return updated;
}

async function recordOfficialBatch(
  ids: readonly number[],
  official: boolean,
  updated: number,
  reason?: string,
): Promise<void> {
  const trimmed = reason?.trim() ?? '';
  await recordAudit({
    verb: 'submission:update',
    entity: 'submission',
    entityId: idsBatchLabel(ids),
    afterValues: { official, requested: ids.length, updated },
    ...(trimmed === '' ? {} : { reason: trimmed }),
    result: 'success',
  });
}

export async function recalculateSubmission(
  submissionId: number,
  type: RecalcType,
  options: RecalcOptions,
): Promise<ActionResult & { message?: string; datasetId?: number | null; timedOut?: boolean }> {
  try {
    await ensureRecalcPermissions();
    const reasonError = requireReason(options);
    if (reasonError !== null) return { success: false, error: reasonError };

    const outcome = await requeueOne(submissionId, type, options);
    if (!outcome.ok) {
      return {
        success: false,
        error: outcome.error,
        ...(outcome.timedOut === true ? { timedOut: true } : {}),
      };
    }
    return { success: true, message: 'Submission queued for recalculation', datasetId: outcome.datasetId };
  } catch (error) {
    // Why rethrow: redirect() signals login expiry by throwing NEXT_REDIRECT; swallowing it would trade the login bounce for an opaque toast.
    const digest = (error as { digest?: string }).digest;
    if (digest?.startsWith('NEXT_REDIRECT')) throw error;
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

/**
 * Requeue one submission, reporting which dataset the run resolved to.
 *
 * WHY this is extracted: the batch path must do exactly what the single path does —
 * same RPC, same table clearing, same audit row, same revalidation — and the only way to
 * guarantee that is for both to call this. A second copy would drift.
 *
 * WHY it does not gate permissions: the caller does, once, so a batch of 200 performs
 * four permission reads rather than eight hundred.
 */
async function requeueOne(
  submissionId: number,
  type: RecalcType,
  options: RecalcOptions,
): Promise<RequeueOutcome> {
  const resolved = await getRecalcContext(submissionId, options.datasetId);
  if (resolved.error !== undefined) return { ok: false, error: resolved.error };

  const rpcResult = await invalidateViaRpc(
    submissionId,
    resolved.context.datasetId,
    rpcLevelFor(type),
    resolved.context.contestId,
  );
  if (rpcResult.timedOut) {
    return { ok: false, error: 'Evaluation service did not respond in time', timedOut: true };
  }
  if (!rpcResult.accepted) {
    return { ok: false, error: 'Resubmission failed: evaluation service did not accept the request' };
  }

  await clearRecalculatedTables(submissionId, type, options.datasetId ?? null);
  await recordAudit({
    verb: 'submission:recompute',
    entity: 'submission',
    entityId: String(submissionId),
    reason: options.reason.trim(),
    afterValues: {
      type,
      datasetId: resolved.context.datasetId,
      ...(options.datasetId === undefined ? {} : { requestedDatasetId: options.datasetId }),
    },
    result: 'success',
  });
  return { ok: true, datasetId: resolved.context.datasetId };
}

async function getRecalcContext(
  submissionId: number,
  requestedDatasetId?: number,
): Promise<RecalcResolution> {
  const submission = await prisma.submissions.findUnique({
    where: { id: submissionId },
    include: {
      tasks: { select: { active_dataset_id: true, contest_tasks: { select: { contest_id: true } } } },
      submission_results: { select: { dataset_id: true } }
    }
  });

  if (!submission) return { error: 'Submission not found' };

  const derived = submission.submission_results?.[0]?.dataset_id
    || submission.tasks?.active_dataset_id
    || null;
  const dataset = await resolveDatasetId(submission.task_id, derived, requestedDatasetId);
  if (dataset.error !== undefined) return { error: dataset.error };

  return {
    context: {
      datasetId: dataset.datasetId,
      contestId: submission.tasks?.contest_tasks?.[0]?.contest_id ?? null,
    },
  };
}

/**
 * A requested dataset must belong to the submission's task: the evaluation service
 * scopes invalidation by dataset, so a foreign id would requeue the wrong task's data.
 */
async function resolveDatasetId(
  taskId: number,
  derived: number | null,
  requested?: number,
): Promise<{ datasetId: number | null; error?: undefined } | { datasetId?: undefined; error: string }> {
  if (requested === undefined) return { datasetId: derived };
  const dataset = await prisma.datasets.findFirst({
    where: { id: requested, task_id: taskId },
    select: { id: true },
  });
  if (!dataset) return { error: `Dataset ${requested} does not belong to this submission's task` };
  return { datasetId: requested };
}

function rpcLevelFor(type: RecalcType): string {
  return type === 'full' ? 'compilation' : (type === 'evaluation' ? 'evaluation' : 'score');
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

/** The id set as a stable audit label; long lists truncate so the row stays readable. */
function idsBatchLabel(ids: readonly number[]): string {
  const shown = ids.slice(0, 10).join(',');
  const rest = ids.length - Math.min(ids.length, 10);
  return rest === 0 ? `ids=${shown}` : `ids=${shown}+${rest}more`;
}

function requireReason(options?: RecalcOptions): string | null {
  const reason = options?.reason?.trim() ?? '';
  return reason === '' ? RECALC_REASON_REQUIRED : null;
}

function emptyBatchReport(): BatchRecalcReport {
  return { processed: 0, succeeded: 0, failed: 0, capped: false, outcomes: [] };
}

function failedBatchReport(error: string): BatchRecalcReport {
  return { ...emptyBatchReport(), error };
}

/** A thrown gate failure becomes a report the bar can render; the login bounce still throws. */
function batchFailure(error: unknown): BatchRecalcReport {
  const digest = (error as { digest?: string }).digest;
  if (digest?.startsWith('NEXT_REDIRECT')) throw error;
  return failedBatchReport(error instanceof Error ? error.message : String(error));
}

function previewOf(matched: number): BatchRecalcPreview {
  return {
    matched,
    willProcess: Math.min(matched, BATCH_RECALC_LIMIT),
    capped: matched > BATCH_RECALC_LIMIT,
    limit: BATCH_RECALC_LIMIT,
  };
}

function uniqueIds(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isFinite(id)))].sort((a, b) => a - b);
}

/**
 * Requeue every id a batch resolved, up to the cap.
 *
 * WHY sequential and not concurrent: the evaluation service takes one submission per
 * RPC over a single connection, and firing hundreds at once would turn a deliberate
 * requeue into a queue spike. Sequential also means the outcomes list is ordered and a
 * partial failure is readable.
 *
 * WHY per-item outcomes rather than a bare count: a batch that reports "38 of 200"
 * without saying which 162 failed is not actionable. Each failure carries its reason.
 */
async function runRecalcBatch(run: BatchRun): Promise<BatchRecalcReport> {
  const outcomes: BatchRecalcOutcome[] = [];
  for (const submissionId of run.ids) {
    // Why a per-item guard: one submission whose RPC times out must not abandon the rest
    // of the batch, so a thrown error becomes this item's outcome.
    let outcome: RequeueOutcome;
    try {
      outcome = await requeueOne(submissionId, run.type, run.options);
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    outcomes.push(
      outcome.ok
        ? { submissionId, ok: true, datasetId: outcome.datasetId }
        : {
            submissionId,
            ok: false,
            error: outcome.error,
            ...(outcome.timedOut === true ? { timedOut: true } : {}),
          },
    );
  }

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
    entityId: run.auditEntityId,
    entity: 'submission',
    reason: run.options.reason.trim(),
    afterValues: {
      type: run.type,
      ...run.auditValues,
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
    capped: run.capped,
    outcomes,
  };
}

export async function recalculateSubmissions(
  scope: BatchRecalcScope,
  type: RecalcType,
  options: RecalcOptions,
): Promise<BatchRecalcReport> {
  try {
    await ensureRecalcPermissions();
    const reasonError = requireReason(options);
    if (reasonError !== null) return failedBatchReport(reasonError);

    const matched = await prisma.submissions.findMany({
      where: batchWhere(scope),
      orderBy: { id: 'asc' },
      take: BATCH_RECALC_LIMIT,
      select: { id: true },
    });

    return await runRecalcBatch({
      ids: matched.map((submission) => submission.id),
      type,
      options,
      auditEntityId: batchScopeLabel(scope),
      auditValues: { scope },
      capped: matched.length === BATCH_RECALC_LIMIT,
    });
  } catch (error) {
    return batchFailure(error);
  }
}

/** What an explicit id selection would requeue, without requeueing it. */
export async function previewRecalculationByIds(ids: readonly number[]): Promise<BatchRecalcPreview> {
  await ensureRecalcPermissions();
  const matched = await prisma.submissions.count({ where: { id: { in: uniqueIds(ids) } } });
  return previewOf(matched);
}

export async function recalculateSubmissionIds(
  ids: readonly number[],
  type: RecalcType,
  options: RecalcOptions,
): Promise<BatchRecalcReport> {
  try {
    await ensureRecalcPermissions();
    const reasonError = requireReason(options);
    if (reasonError !== null) return failedBatchReport(reasonError);

    const selection = uniqueIds(ids);
    if (selection.length === 0) return emptyBatchReport();

    const matched = await prisma.submissions.findMany({
      where: { id: { in: selection } },
      orderBy: { id: 'asc' },
      take: BATCH_RECALC_LIMIT,
      select: { id: true },
    });

    return await runRecalcBatch({
      ids: matched.map((submission) => submission.id),
      type,
      options,
      auditEntityId: idsBatchLabel(selection),
      auditValues: { ids: selection },
      capped: matched.length === BATCH_RECALC_LIMIT,
    });
  } catch (error) {
    return batchFailure(error);
  }
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

/**
 * Clears what the RPC just invalidated; an explicit dataset narrows the clear to
 * that dataset so the other datasets' results survive their untouched requeue.
 */
async function clearRecalculatedTables(
  submissionId: number,
  type: RecalcType,
  datasetId: number | null,
): Promise<void> {
  const scope = datasetId === null
    ? { submission_id: submissionId }
    : { submission_id: submissionId, dataset_id: datasetId };

  if (type === 'evaluation' || type === 'full') {
    await prisma.evaluations.deleteMany({ where: scope });
  }

  if (type === 'score' || type === 'full') {
    await prisma.submission_results.deleteMany({ where: scope });
  }
}

/** Returns per-field read/update booleans for the submissions entity based on the current user's permissions. */
export async function getSubmissionFieldAccess(): Promise<Record<string, FieldAccess>> {
  const effectivePermissions = await getPermissions();
  return getFieldAccess('submissions', effectivePermissions);
}
