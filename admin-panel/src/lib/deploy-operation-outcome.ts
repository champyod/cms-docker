import { DEPLOY_EFFECT_LEASE_MS } from '@/lib/constants/deploy';
import { patchDeployMeta, readDeployMeta, withMetaMutation, writeDeployMeta, type DeployMeta, type DeployOutcome } from '@/lib/deploy-operation-meta';

/**
 * The answer to "may I run this outcome's effects, and for which outcome".
 *
 * - `yours`: nothing has claimed this operation, or the settler that did never finished and its lease
 *   has run out — the effects are this caller's to run, and `outcome` is what to run them for (the
 *   record's own outcome when taking over, not the caller's, so a recovery applies what was claimed);
 * - `reported`: nothing is this caller's to run. `outcome` is the result to report. `applied` says which
 *   of the two reasons applies: `true` — the effects are done; `false` — another settler's claim is still
 *   inside its lease, so those effects may be running right now and must not be started alongside it.
 */
export type OutcomeClaim =
  | { kind: 'yours'; outcome: DeployOutcome }
  | { kind: 'reported'; outcome: DeployOutcome; applied: boolean };

/**
 * When the claim on a record started running its effects, or null when the record cannot say. A missing
 * stamp is a claim written by a panel older than the field; an unparseable one is a stamp this panel
 * cannot read. Neither can be shown to have been abandoned, which is why `claimDeployOutcome` dates it
 * rather than reading it as expired.
 */
function claimTimestamp(meta: DeployMeta): number | null {
  if (meta.outcomeClaimedAt === undefined) return null;
  const claimedAt = Date.parse(meta.outcomeClaimedAt);
  return Number.isNaN(claimedAt) ? null : claimedAt;
}

/**
 * Takes the claim on an operation's outcome — the only caller allowed to perform its side effects
 * (activating a contest, reverting config.toml, notifying Discord, running the config sync).
 *
 * What the claim buys: settling is reachable concurrently from the status stream of every open tab, the
 * 30s discovery lookup and the pre-guard reconcile, and writing the claim first is what makes a second
 * settler read "someone else's" instead of activating, notifying and syncing alongside this one. That
 * exclusion holds while the claim is held — it is not a promise that the effects run exactly once. A
 * settler that crashes after claiming leaves them to be taken over (below), and taking one over runs them
 * again; the last paragraph is why that is acceptable, and it is what a caller may rely on.
 *
 * Why a lease and not just "a claim is a claim": a crash between the claim and the effects leaves an
 * outcome on the record that nothing would ever apply — the contest never activated while every lookup
 * reported success, or config.toml keeping a contest the rollback never reverted. Deleting the record
 * later is not recovery. So an unapplied claim is taken over once it is older than
 * `DEPLOY_EFFECT_LEASE_MS`, which is far longer than the effects themselves and far shorter than an
 * operator's patience. Taking one over re-stamps the lease, which is what stops two concurrent lookups
 * in this process from both deciding they own the effects.
 *
 * Why a claim that cannot be dated is stamped instead of taken over: the record of an operation in flight
 * across an upgrade carries no stamp, because the field did not exist when it was written. Reading that as
 * expired hands the effects to whichever lookup asks first for *every* such record at once, repeating an
 * activation (and its audit row), a revert, a config sync and a Discord notice for each of them. Stamping
 * it with the first sighting starts its lease there instead: nothing is re-run on the way in, and the
 * effects are still recovered one lease later if nobody ever finished them.
 *
 * What a taken-over claim can re-run, and why that is the lesser evil: an activation is a set, the
 * revert is guarded by the contest id the file still has to name (see `rollbackContestId`), and a
 * Discord notice can repeat. The alternative — never applying what the record says happened — leaves
 * the panel asserting a state the system is not in, which is what this module exists to prevent.
 */
export async function claimDeployOutcome(operationId: string, outcome: DeployOutcome): Promise<OutcomeClaim> {
  return withMetaMutation(operationId, async () => {
    const meta = await readDeployMeta(operationId);
    // The record is gone: there is nothing left to claim or to mark applied, and refusing to run the
    // effects would drop an activation on the floor. Same answer the claim gave before this type existed.
    if (meta === null) return { kind: 'yours', outcome };
    const recorded = meta.outcome;
    if (recorded !== undefined) {
      if (meta.outcomeAppliedAt !== undefined) return { kind: 'reported', outcome: recorded, applied: true };
      const claimedAt = claimTimestamp(meta);
      if (claimedAt === null) {
        await writeDeployMeta(operationId, { ...meta, outcomeClaimedAt: new Date().toISOString() });
        return { kind: 'reported', outcome: recorded, applied: false };
      }
      if (Date.now() - claimedAt <= DEPLOY_EFFECT_LEASE_MS) return { kind: 'reported', outcome: recorded, applied: false };
      await writeDeployMeta(operationId, { ...meta, outcomeClaimedAt: new Date().toISOString() });
      return { kind: 'yours', outcome: recorded };
    }
    await writeDeployMeta(operationId, { ...meta, outcome, outcomeClaimedAt: new Date().toISOString() });
    return { kind: 'yours', outcome };
  });
}

/**
 * Records that a claim's effects have finished, which is what a later panel reads instead of running
 * them again. Called by the claim's owner only, and before it releases the deploy guard: the state that
 * must not exist is a free guard over effects that have not landed.
 *
 * `outcome` replaces the claim when the effect's result is its own — a rollback that failed is the
 * outcome, not a warning on the claim that preceded it.
 */
export async function markDeployOutcomeApplied(operationId: string, outcome?: DeployOutcome): Promise<void> {
  await patchDeployMeta(operationId, {
    outcomeAppliedAt: new Date().toISOString(),
    ...(outcome === undefined ? {} : { outcome }),
  });
}
