// The bulk waiver's applying half: one auditor-approved write per CVE the hosts cannot reach.
import { recordAudit } from '@/lib/audit';
import { createWaiver, parseReviewDate } from './patching-waivers';
import {
  WAIVED_SOURCE,
  planBulkWaive,
  type BulkWaiveInput,
  type BulkWaivePlanEntry,
  type BulkWaiveResult,
  type Draft,
} from './patching-bulk-waive-plan';

export type {
  BulkWaiveCounts,
  BulkWaiveInput,
  BulkWaivePlanEntry,
  BulkWaiveRefusal,
  BulkWaiveResult,
} from './patching-bulk-waive-plan';

/**
 * WHY this module and not the server action: the plan, the refusals and the writes are the same
 * decision whether an operator triggers them or a CLI does with the `root` actor, exactly like the
 * single waiver beside it. The action adds the permission check, the actor and the refresh.
 */

/** What a write left behind; a dry run leaves nothing, which is a value here rather than a branch. */
interface Written {
  readonly ids: readonly number[];
  readonly failures: readonly string[];
}

const NO_WRITES: Written = { ids: [], failures: [] };

const PLAN_CHANGED = 'the plan changed since it was previewed; preview it again before writing';

/** The result shape every path returns, so a refusal and a success describe the same plan alike. */
function resultOf(dryRun: boolean, reviewBy: string, draft: Draft, written: Written): BulkWaiveResult {
  return {
    success: true,
    dryRun,
    reviewBy,
    plan: draft.entries,
    refusals: draft.refusals,
    waiverIds: written.ids,
    failures: written.failures,
    counts: { ...draft.counts, waived: written.ids.length },
  };
}

/** The refusal shape for a failed call, so every early return has the same fields. */
export function refusedBulkWaive(error: string, dryRun: boolean, reviewBy = ''): BulkWaiveResult {
  return {
    success: false,
    error,
    dryRun,
    reviewBy,
    counts: { candidates: 0, alreadyWaived: 0, refusedReachable: 0, refusedUnknown: 0, findingsWaived: 0, planned: 0, waived: 0 },
    plan: [],
    refusals: [],
    waiverIds: [],
    failures: [],
  };
}

/** Writes the plan one waiver at a time, so every row carries its own audit entry. */
async function writePlan(
  actorId: number,
  entries: readonly BulkWaivePlanEntry[],
  reviewBy: string,
  now: Date,
): Promise<Written> {
  const ids: number[] = [];
  const failures: string[] = [];
  for (const entry of entries) {
    const result = await createWaiver(actorId, { source: WAIVED_SOURCE, match: entry.match, reason: entry.reason, reviewBy }, now);
    if (result.success && result.id !== undefined) ids.push(result.id);
    else failures.push(`${entry.match}: ${result.error ?? 'the waiver was not recorded'}`);
  }
  return { ids, failures };
}

/**
 * Plans — and unless `dryRun`, records — one waiver per unreachable CVE.
 *
 * WHY the guard runs on the whole group: a waiver matching a CVE covers every finding carrying it,
 * including a reachable one on another host. Waiving a CVE that is reachable anywhere would suppress
 * a live risk, so the worst verdict in the group decides and the refusal is reported per row.
 *
 * WHY `expectedWaivers`: the operator confirms a count they read in the dialog, and a scan landing
 * between the preview and the press would make the button write a different plan than the one it
 * described. A mismatched count refuses the write and returns the fresh plan to preview again.
 */
export async function waiveUnreachableFindings(
  actorId: number,
  input: BulkWaiveInput,
  now: Date = new Date(),
): Promise<BulkWaiveResult> {
  const dryRun = input.dryRun === true;
  const parsed = parseReviewDate(input.reviewBy, now);
  if (parsed === null) return refusedBulkWaive('review_by must be a future date', dryRun, input.reviewBy);
  const reviewBy = parsed.toISOString().slice(0, 10);
  const draft = await planBulkWaive(reviewBy);
  const stale = input.expectedWaivers !== undefined && input.expectedWaivers !== draft.counts.planned;
  if (!dryRun && stale) {
    return { ...resultOf(true, reviewBy, draft, NO_WRITES), success: false, error: PLAN_CHANGED };
  }
  const written = dryRun ? NO_WRITES : await writePlan(actorId, draft.entries, reviewBy, now);
  if (!dryRun && written.ids.length > 0) {
    await recordAudit({
      actorId,
      verb: 'security.waiver.bulk-create',
      entity: 'security_waiver',
      afterValues: { review_by: reviewBy, waived: written.ids.length },
      reason: `bulk waiver of unreachable kernel CVEs: ${String(written.ids.length)} created, ${String(draft.counts.refusedReachable + draft.counts.refusedUnknown)} refused`,
      result: 'success',
    });
  }
  return resultOf(dryRun, reviewBy, draft, written);
}
