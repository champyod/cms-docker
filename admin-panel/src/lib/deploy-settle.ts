import { logToDiscord } from '@/lib/discord-notifier';
import { parseDeployPercent } from '@/lib/deploy-percent.shared';
import {
  claimDeployOutcome,
  clearActiveOperation,
  markDeployOutcomeApplied,
  patchDeployMeta,
  type DeployMeta,
  type DeployOutcome,
} from '@/lib/deploy-operation-store';
import { rollbackContestId } from '@/lib/deploy-config';
import type { DeployStatusResult } from '@/lib/deploy-status';

async function finalizeContestActivation(contestId: number): Promise<void> {
  const { activateContest } = await import('@/app/actions/contests');
  const result = await activateContest(contestId);
  if (!result.success) throw new Error(result.error ?? 'activateContest failed');
}

/**
 * Applies the effects of the outcome this operation's record claims, outside-in: the record on disk
 * decides, and it also says whether they still have to run at all.
 *
 * Why every settle goes through the claim and not straight to the effects: settling is reachable
 * concurrently from the status stream of every open tab, the 30s discovery lookup and the pre-guard
 * reconcile, and the effects below must not run alongside a second settler's. The claim is what makes the
 * second settler read "someone else's" instead of activating, reverting, notifying and syncing along with
 * this one. It excludes them while it is held; it does not make them happen exactly once — a claim handed
 * back to this caller when its settler never came back runs them again, deliberately (see
 * `claimDeployOutcome`).
 *
 * Why a claim already on the record is still applied here: `claimDeployOutcome` hands the effects back
 * to this caller when the settler that took the claim never came back — the crash between the claim and
 * its effects. Treating every recorded outcome as done is what reports a result that never happened: a
 * contest never activated while every lookup answers "completed", or a rollback that never ran while
 * config.toml keeps the contest the deploy did not reach.
 */
export async function applyClaimedOutcome(operationId: string, meta: DeployMeta, log: string, outcome: DeployOutcome): Promise<DeployStatusResult> {
  const claim = await claimDeployOutcome(operationId, outcome);
  if (claim.kind === 'reported') {
    // Why the guard is released here when the claim is applied: the effects are done, so nothing is owed
    // and no deploy starts behind work in flight — and the state a crash between `markDeployOutcomeApplied`
    // and the settle's own release leaves is exactly this one. Without it the guard holds until the
    // cleanup ages the record out (`DEPLOY_STALE_MS`), refusing every deploy for that long. An *unapplied*
    // claim releases nothing: its settler may be inside the effects right now, and the guard is what keeps
    // a new deploy's config.toml write out of the revert's read-then-write window (see
    // `clearActiveOperation`).
    if (claim.applied) await clearActiveOperation(operationId);
    return settledStatus(meta, log, claim.outcome);
  }
  return claim.outcome.status === 'completed'
    ? applyCompletedOutcome(operationId, meta, log)
    : applyFailedOutcome(operationId, meta, log, claim.outcome.error ?? 'Deploy failed.');
}

/**
 * Applies a deploy docker reported as successful: the contest is activated — the only place the DB's
 * is_active moves — and the claim is marked applied so no later lookup activates or notifies twice.
 *
 * Why an activation failure is recorded as the terminal result rather than left unapplied: the
 * containers run this contest and config.toml names it, so nothing may be reverted. A recorded failure
 * is the honest state: the operator sees it, and can activate the contest from the contests page.
 *
 * Why the claim is marked applied even then: an unapplied claim is one a later panel takes over and
 * runs again (see `claimDeployOutcome`), which would re-attempt an activation this panel has already
 * watched fail. The failure is this operation's outcome, not a state to retry.
 *
 * Why the activated id is recorded before the claim is marked applied: the field says which contest the
 * database is on, so it has to be on the record by the time the record can no longer be re-run. An
 * activation that fails writes none of it — the database was left as it was, and the terminal outcome's
 * error is what says so.
 */
async function applyCompletedOutcome(operationId: string, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  const base = { contestId: meta.contestId, startedAt: meta.startedAt, log, percent: parseDeployPercent(log) };
  try {
    await finalizeContestActivation(meta.contestId);
  } catch (error) {
    const outcome: DeployOutcome = {
      status: 'failed',
      error: `Deploy completed but contest activation failed: ${(error as Error).message}`,
    };
    await markDeployOutcomeApplied(operationId, outcome);
    await clearActiveOperation(operationId);
    await logToDiscord('Contest Deploy Failed', `Contest ID **${meta.contestId}**: ${outcome.error}`, 15158332, true);
    return { success: false, status: 'failed', ...base, error: outcome.error };
  }

  await patchDeployMeta(operationId, { activatedContestId: meta.contestId });
  await markDeployOutcomeApplied(operationId);
  await clearActiveOperation(operationId);
  await logToDiscord('Contest Deploy Completed', `Contest ID **${meta.contestId}** deployed successfully.`, 3066993);
  return { success: true, status: 'completed', ...base };
}

/**
 * Applies an outcome reported as a failure, and is the only place `config.toml` is reverted.
 *
 * Why only here: a revert contradicts the running containers the moment the deploy did succeed, which
 * is how the panel ended up with configuration, database and containers asserting three different
 * contests. So a revert waits for evidence that there is no success to lose — a non-zero exit docker
 * reported, or a process gone without reporting at all. A watch timing out is not that evidence.
 *
 * The claimed outcome carries the error; the warning the rollback produces is written with it in the
 * completion marker, so the record holds both in one step.
 */
async function applyFailedOutcome(operationId: string, meta: DeployMeta, log: string, error: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);
  const rollbackFailure = await rollbackContestId(meta);
  const warning = rollbackFailure ?? undefined;
  await markDeployOutcomeApplied(operationId, { status: 'failed', error, warning });
  await clearActiveOperation(operationId);
  await logToDiscord('Contest Deploy Failed', `Contest ID **${meta.contestId}**: ${error}`, 15158332, true);
  return { success: false, status: 'failed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error, warning };
}

/**
 * The status of an outcome whose effects this caller must not run — they are done, or another settler
 * is inside the lease that claimed them. Reports the result; repeats no side effect.
 */
function settledStatus(meta: DeployMeta, log: string, outcome: DeployOutcome): DeployStatusResult {
  const base = { contestId: meta.contestId, startedAt: meta.startedAt, log, percent: parseDeployPercent(log) };
  return outcome.status === 'completed'
    ? { success: true, status: 'completed', ...base }
    : { success: false, status: 'failed', ...base, error: outcome.error, warning: outcome.warning };
}
