import 'server-only';

import fs from 'fs/promises';
import path from 'path';

import { DEPLOY_STALE_MS } from '@/lib/constants/deploy';
import { clearActiveOperation, getActiveOperationId, getDeployLogsDir, getDeployOperationPaths } from '@/lib/deploy-operation-paths';
import { readDeployMeta } from '@/lib/deploy-operation-meta';
import { probeDeployProcess } from '@/lib/deploy-operation-process';

export {
  clearActiveOperation,
  ensureDeployLogsDir,
  generateOperationId,
  getActiveOperationId,
  getDeployOperationPaths,
  setActiveOperationId,
} from '@/lib/deploy-operation-paths';
export {
  listDeployOperations,
  patchDeployMeta,
  readDeployMeta,
  recordDeployOperationStart,
  type DeployMeta,
  type DeployOperation,
  type DeployOutcome,
} from '@/lib/deploy-operation-meta';
export { claimDeployOutcome, markDeployOutcomeApplied, type OutcomeClaim } from '@/lib/deploy-operation-outcome';
export { probeDeployProcess, recordDeployProcess, type DeployProcessVerdict } from '@/lib/deploy-operation-process';

/**
 * Discards the records the panel has finished with.
 *
 * Why after settling and never while a process is alive: deleting a record is what forgets an
 * operation, so a record of a deploy that is still building — or one whose result has not been
 * applied yet — must survive. Reconciliation (deploy-store) settles first, which leaves only settled
 * records and operations with no process left to wait for.
 *
 * Why an unread marker blocks the delete even for an aged-out record: `.done`/`.error` is the only
 * surviving evidence that the deploy ended, so discarding it loses the activation (or the revert)
 * the operation still owes — which is how a finished deploy left the contest inactive while
 * config.toml and its containers named it.
 *
 * Why an unapplied claim blocks it too: the record is the only thing that says the effects are still
 * owed, so deleting it is not recovery — it is the loss of the activation or the revert the panel was
 * still going to apply (see `claimDeployOutcome`).
 *
 * Why the probe's answer and not the record's age decides the rest: an aged record whose process table
 * this panel is not in is discarded only once the unobservable bound has passed *and* its log has gone
 * silent (see `probeDeployProcess`), because until then it is indistinguishable from a deploy that is
 * still building in a container this panel cannot look into.
 *
 * Why the guard is released before the record it belongs to is unlinked: a crash between the two then
 * leaves a record with no guard, which the next pass discards and which refuses nothing, instead of a
 * guard naming a record that does not exist. The other order — the one this replaced — leaves the panel
 * with no way back: this enumeration only ever sees `*.json`, so an orphaned guard is invisible to it,
 * `runDeployContest` refuses every deploy while the guard is set, and the mount lookup reports no
 * operation at all. The first pass below (`releaseGuardWithNoRecord`) is what recovers a guard already
 * left in that state.
 */
export async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  await releaseGuardWithNoRecord();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const jsonFile of files.filter((file) => file.endsWith('.json'))) {
    const operationId = jsonFile.replace('.json', '');
    const meta = await readDeployMeta(operationId);
    if (meta === null) continue;
    if (Date.now() - new Date(meta.startedAt).getTime() <= DEPLOY_STALE_MS) continue;
    const verdict = await probeDeployProcess(operationId, meta);
    // Why both of the deferring verdicts exist here: `alive` is a deploy that is still building, and
    // `unobservable` is one this panel cannot rule out at all — the same two reasons the status
    // resolution keeps reporting it as running. `presumed-gone` is the bound's answer, not a witness's.
    if (verdict === 'alive' || verdict === 'unobservable') continue;
    if (meta.outcome !== undefined && meta.outcomeAppliedAt === undefined) continue;
    if (meta.outcome === undefined) {
      const { donePath, errorPath } = getDeployOperationPaths(operationId);
      const exists = async (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);
      if ((await exists(donePath)) || (await exists(errorPath))) continue;
    }
    // Before the record goes, and ownership-checked inside, so a guard that has already moved on to a
    // newer operation survives.
    await clearActiveOperation(operationId);
    await fs.unlink(path.join(dir, `${operationId}.json`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.log`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.done`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.error`)).catch(() => {});
  }
}

/**
 * Frees the deploy guard when the operation it names has no record to guard.
 *
 * Why this exists: the guard and the record are released by two filesystem calls, so a panel that dies
 * between them — or a container that is recreated there — leaves a guard naming an operation whose record
 * is gone. Nothing else recovers from that state: the enumeration above only sees `*.json`, so it never
 * finds the guard; `runDeployContest` refuses every deploy while any guard is set; and the mount lookup
 * answers "no operation", because there is no metadata to report. The panel is then locked out with
 * nothing in the UI to explain it, which is the state this whole path exists to keep out of reach.
 *
 * What counts as "no record": one that cannot be read, including one whose contents do not parse. Both
 * leave the guard with nothing behind it and the panel equally unable to say what the operation was, and
 * the alternative — leaving the guard set — is the lockout above.
 */
async function releaseGuardWithNoRecord(): Promise<void> {
  const operationId = await getActiveOperationId();
  if (operationId === null) return;
  if ((await readDeployMeta(operationId)) !== null) return;
  await clearActiveOperation(operationId);
}
