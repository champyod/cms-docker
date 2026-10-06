import 'server-only';

import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';

import { logToDiscord } from '@/lib/discord-notifier';
import {
  cleanStaleOperations,
  clearActiveOperation,
  ensureDeployLogsDir,
  generateOperationId,
  getActiveOperationId,
  getDeployOperationPaths,
  listDeployOperations,
  readDeployMeta,
  recordDeployOperationStart,
  recordDeployProcess,
  type DeployMeta,
} from '@/lib/deploy-operation-store';
import { buildContestDeployCommand, buildDeployScript, type ContestDeployPlan } from '@/lib/deploy-command';
import { readConfigTomlContestId, runConfigSync, updateConfigTomlContestId } from '@/lib/deploy-config';
import { fetchDeployStatus } from '@/lib/deploy-status';
import { getRepoRoot } from '@/lib/repo-root';

export type { DeployStatus } from '@/lib/deploy-percent.shared';
export { parseDeployPercent, DEPLOY_IDLE_TIMEOUT_MS } from '@/lib/deploy-percent.shared';
export { buildContestDeployCommand, buildDeployScript, type ContestDeployPlan } from '@/lib/deploy-command';
export { fetchDeployStatus, type DeployStatusResult } from '@/lib/deploy-status';

export interface DeployContestResult {
  success: boolean;
  operationId?: string;
  error?: string;
  alreadyRunning?: boolean;
}

/**
 * Starts the deploy as a detached shell and lets it report through files only.
 *
 * Why a shell: the plan is a `(… pull || true) && … up` sequence and quotes the host paths compose
 * needs when the panel runs in its container — neither fits into a single argv. Why detached and
 * unref'd: the build must outlive the request that started it, and the panel process itself.
 */
async function launchDetachedDeploy(operationId: string, command: string): Promise<void> {
  const { logPath, donePath, errorPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(logPath, '', { encoding: 'utf-8' });

  const logStream = fsSync.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(
    'sh',
    ['-c', buildDeployScript(command), 'cms-deploy', donePath, errorPath],
    {
      cwd: getRepoRoot(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Only the log stream is closed here: the markers are written by the script itself, which is what
  // makes the outcome readable after this panel process is gone.
  child.on('close', () => {
    logStream.end();
  });

  child.unref();

  // The pid is what lets a later process tell "still building" from "gone without a word"; the
  // process table it was spawned in is what keeps that probe answerable after a panel restart.
  await recordDeployProcess(operationId, child.pid);
}

/**
 * Settles every operation whose outcome the panel has not applied yet, then discards the records it is
 * done with.
 *
 * Why this exists rather than relying on a live watcher: a watch ends — the panel releases it at its
 * observation ceiling, the tab closes, the panel restarts — while the deploy's process keeps building
 * and writes its `.done` when it finishes. Without reconciliation nothing reads that marker: a deploy
 * that succeeded would leave its contest inactive while its containers serve it, and a finished
 * operation would keep the guard until it aged out, refusing the next deploy. Every entry point that
 * asks about deploys runs this first, so a panel that just restarted reaches the truth on its next
 * request.
 */
export async function reconcileDeployOperations(): Promise<void> {
  for (const { operationId } of await listDeployOperations()) {
    // fetchDeployStatus is the one resolution rule; reconciliation only applies it to every record.
    // Every record, including one that already has an outcome: that outcome is a claim, and this is
    // where a claim whose effects never ran — the panel that took it is gone — gets them applied.
    await fetchDeployStatus(operationId);
  }
  await cleanStaleOperations();
}

export async function runDeployContest(contestId: number, plan: ContestDeployPlan): Promise<DeployContestResult> {
  try {
    await ensureDeployLogsDir();
    // Why before the guard: a leftover operation that already finished must not block this deploy, and
    // one that is still running must. Settling also leaves config.toml on the contest the database
    // actually has active, which is the id this deploy records as the one to roll back to.
    await reconcileDeployOperations();
    if ((await getActiveOperationId()) !== null) return { success: false, alreadyRunning: true, error: 'A deploy is already in progress.' };

    const previousContestId = await readConfigTomlContestId();
    if (previousContestId === null) return { success: false, error: 'Could not read CONTEST_ID from config.toml.' };

    await updateConfigTomlContestId(contestId);
    try {
      await runConfigSync();
    } catch (error) {
      await updateConfigTomlContestId(previousContestId).catch(() => {});
      return { success: false, error: 'Config sync failed: ' + (error as Error).message };
    }

    const operationId = generateOperationId();
    const meta: DeployMeta = { contestId, startedAt: new Date().toISOString(), previousContestId };
    try {
      await recordDeployOperationStart(operationId, meta);
    } catch (error) {
      // The contest id is already in config.toml with nothing recorded behind it: revert rather than
      // leave the file naming a contest the database was never told about.
      await updateConfigTomlContestId(previousContestId).catch(() => {});
      return { success: false, error: (error as Error).message };
    }

    try {
      await launchDetachedDeploy(operationId, buildContestDeployCommand(plan));
    } catch (error) {
      // Nothing was started, so there is no work to observe: give back the guard this operation just
      // took (checked inside `clearActiveOperation`) and the contest id.
      await clearActiveOperation(operationId);
      await updateConfigTomlContestId(previousContestId).catch(() => {});
      return { success: false, error: (error as Error).message };
    }

    await logToDiscord('Contest Deploy Started', `Admin triggered async deploy for contest ID **${contestId}**. Operation: \`${operationId}\``, 16753920, true);
    return { success: true, operationId };
  } catch (error) {
    // Why this catch releases nothing: everything above it either runs before the guard is taken or
    // releases it itself. Clearing the lock from here could free a deploy that is still building.
    return { success: false, error: (error as Error).message };
  }
}

export interface ActiveDeployOperation {
  operationId: string;
  contestId: number;
  startedAt: string;
  percent: number | null;
}

// Why: a page refresh must be able to rejoin an in-flight deploy; the lock is cleared only on a terminal result.
export async function getActiveDeployOperation(): Promise<ActiveDeployOperation | null> {
  // Why reconcile first: an operation that finished while nobody watched — including across a panel
  // restart — has to be activated or reverted before the panel concludes that nothing is live.
  await reconcileDeployOperations();
  const operationId = await getActiveOperationId();
  if (operationId === null) return null;
  const meta = await readDeployMeta(operationId);
  if (meta === null) return null;
  const status = await fetchDeployStatus(operationId);
  if (status.status !== 'running') return null;
  return {
    operationId,
    contestId: meta.contestId,
    startedAt: meta.startedAt,
    percent: status.percent ?? null,
  };
}
