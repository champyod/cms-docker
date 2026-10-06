import fs from 'fs/promises';

import { DEPLOY_OPERATION_ID_REGEX, DEPLOY_STALE_LABEL, DEPLOY_STALE_MS, DEPLOY_UNOBSERVABLE_LABEL } from '@/lib/constants/deploy';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { getDeployOperationPaths, probeDeployProcess, readDeployMeta, type DeployMeta } from '@/lib/deploy-operation-store';
import { applyClaimedOutcome } from '@/lib/deploy-settle';

export interface DeployStatusResult {
  success: boolean;
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log?: string;
  error?: string;
  warning?: string;
  percent?: number | null;
}

function runningStatus(meta: DeployMeta, log: string): DeployStatusResult {
  return { success: true, status: 'running', contestId: meta.contestId, startedAt: meta.startedAt, log, percent: parseDeployPercent(log) };
}

async function fileExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

/**
 * The truth about one operation, from the only two things that can report it: the marker the deploy's
 * process writes as it exits, and whether that process still exists.
 *
 * Why nothing else is consulted: elapsed time and log silence are properties of the *watch*, not of
 * the deploy — a docker build step is silent for minutes while working, and a legitimate deploy can
 * outlast any clock. That is why a timeout stops the watch (route, hook) and never reaches this state.
 * The clocks that do appear below are not the watch's: each stands in for evidence this panel cannot
 * get — a record with no process of its own to watch, or one whose process table is not this panel's.
 */
async function resolveDeployStatus(operationId: string, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  // Why a settled-looking record still comes through here: the outcome is a claim, and the claim's
  // effects are applied only when the completion marker beside it says they landed (see
  // `applyClaimedOutcome`). Reporting a claim as settled is what left a crashed settle's contest
  // inactive while every lookup answered "completed".
  if (meta.outcome) return applyClaimedOutcome(operationId, meta, log, meta.outcome);

  const paths = getDeployOperationPaths(operationId);
  if (await fileExists(paths.donePath)) {
    return applyClaimedOutcome(operationId, meta, log, { status: 'completed' });
  }

  const errorContent = await fs.readFile(paths.errorPath, 'utf-8').catch(() => null);
  if (errorContent !== null) {
    return applyClaimedOutcome(operationId, meta, log, {
      status: 'failed',
      error: `Docker process exited with code ${errorContent.trim()}.`,
    });
  }

  if (meta.pid !== undefined) {
    const verdict = await probeDeployProcess(operationId, meta);
    // Why the unobservable verdict is 'running' and not a settle: the panel cannot see this record's
    // process table at all, so it has nothing that says the deploy ended. It also must not wait forever
    // (see `probeDeployProcess`): past the bound the same verdict comes back as `presumed-gone`, unless
    // the operation's log is still being written to — which is the one piece of evidence this panel can
    // get about a deploy in a process table it cannot look into.
    if (verdict === 'alive' || verdict === 'unobservable') return runningStatus(meta, log);
    // Gone and silent: its result never arrived, so nothing it did can be trusted. Nobody is working.
    return applyClaimedOutcome(operationId, meta, log, {
      status: 'failed',
      error: verdict === 'gone'
        ? 'Deploy process is gone without reporting a result.'
        : `Deploy gave no result within ${DEPLOY_UNOBSERVABLE_LABEL}.`,
    });
  }

  // No process recorded (a record written by an older panel). Existence cannot be checked, so the
  // stale bound decides, and it is deliberately generous: being wrong here reverts a live deploy.
  if (Date.now() - new Date(meta.startedAt).getTime() > DEPLOY_STALE_MS) {
    return applyClaimedOutcome(operationId, meta, log, {
      status: 'failed',
      error: `Deploy gave no result within ${DEPLOY_STALE_LABEL}.`,
    });
  }
  return runningStatus(meta, log);
}

export async function fetchDeployStatus(operationId: string): Promise<DeployStatusResult> {
  if (!DEPLOY_OPERATION_ID_REGEX.test(operationId)) return { success: false, status: 'not_found', error: 'Invalid operation ID.' };
  const meta = await readDeployMeta(operationId);
  if (meta === null) return { success: false, status: 'not_found', error: 'Operation not found.' };
  const log = await fs.readFile(getDeployOperationPaths(operationId).logPath, 'utf-8').catch(() => '');
  return resolveDeployStatus(operationId, meta, log);
}
