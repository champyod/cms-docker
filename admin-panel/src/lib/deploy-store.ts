import 'server-only';

import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import util from 'util';

import { composeLocationFlags, type HostComposeLocation } from '@/lib/compose-location';
import { DEPLOY_OPERATION_ID_REGEX, DEPLOY_STALE_LABEL, DEPLOY_STALE_MS } from '@/lib/constants/deploy';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import { readContestId, setContestId } from '@/lib/active-contest';
import type { DeploymentMode } from '@/lib/deployment-mode';
import {
  cleanStaleOperations,
  clearActiveOperation,
  ensureDeployLogsDir,
  generateOperationId,
  getActiveOperationId,
  getDeployOperationPaths,
  isDeployProcessAlive,
  listDeployOperations,
  patchDeployMeta,
  readDeployMeta,
  recordDeployOperationStart,
  type DeployMeta,
  type DeployOutcome,
  type DeployPaths,
} from '@/lib/deploy-operation-store';

const execPromise = util.promisify(exec);

const CONFIG_SYNC_COMMAND = 'bash scripts/__config_sync.sh';

/** The profiles the Makefile's contest target enables; core comes with contest for depends_on validation. */
const CONTEST_PROFILES = ['--profile', 'core', '--profile', 'contest'];

/** The contest stack's own services, which are also what the retired per-stack file contained. */
const CONTEST_SERVICES = ['evaluation-service', 'proxy-service', 'contest-web-server', 'nginx-proxy'];

export type { DeployStatus } from '@/lib/deploy-percent.shared';
export { parseDeployPercent, DEPLOY_IDLE_TIMEOUT_MS } from '@/lib/deploy-percent.shared';

/**
 * Everything the compose invocation needs, resolved by the caller the same way a restart resolves it
 * (see `restartServices`): the `-f` list, the deployment mode and the host location. Passing it in
 * rather than resolving it here keeps the deploy on the same project the make targets and the
 * restarts run, instead of a second opinion about which files and flags are canonical.
 */
export interface ContestDeployPlan {
  files: string;
  mode: DeploymentMode;
  location: HostComposeLocation | null;
}

export interface DeployContestResult {
  success: boolean;
  operationId?: string;
  error?: string;
  alreadyRunning?: boolean;
}

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

const getConfigTomlPath = (): string => path.join(getRepoRoot(), 'config.toml');

async function readConfigTomlContestId(): Promise<number | null> {
  const content = await fs.readFile(getConfigTomlPath(), 'utf-8').catch(() => null);
  if (content === null) return null;
  return readContestId(content);
}

async function updateConfigTomlContestId(contestId: number): Promise<void> {
  const content = await fs.readFile(getConfigTomlPath(), 'utf-8');
  await fs.writeFile(getConfigTomlPath(), setContestId(content, contestId));
}

async function runConfigSync(): Promise<void> {
  await execPromise(CONFIG_SYNC_COMMAND, { cwd: getRepoRoot() });
}

/**
 * The contest stack as the project's own entry points bring it up: the unified project (the `-f` list
 * the Makefile's wildcard builds and the restart path passes), the core and contest profiles, and the
 * deployment mode deciding pull + `--no-build` versus `--build`.
 *
 * Why not the per-stack `docker-compose.contest.yml` this used to run: that file declares no image
 * names, so compose derives `<project>-<service>` images nothing else in the project builds or pulls —
 * an image-mode pull against them cannot succeed, and a source build leaves the running stack on
 * images the rest of the project never touches. `lib/restart-planner.ts` was just fixed for exactly
 * this defect; this mirrors it rather than inventing a second convention (the shared home would be
 * that file, which another change owns).
 *
 * Why the four contest services stay the scope: `--force-recreate` applies to the services named, and
 * the contest stack carries core in its profiles for depends_on validation — naming the scope keeps
 * activating a contest from restarting the database.
 */
export function buildContestDeployCommand(plan: ContestDeployPlan): string {
  const invocation = ['docker', 'compose', composeLocationFlags(plan.location), plan.files, CONTEST_PROFILES.join(' ')]
    .filter((part) => part.length > 0)
    .join(' ');
  const scope = CONTEST_SERVICES.join(' ');
  const recreate = `${invocation} up -d ${plan.mode === 'src' ? '--build' : '--no-build'} --force-recreate ${scope}`;
  // Best-effort pull, exactly like the Makefile's `pull || true`: the host may already hold the image
  // this deployment runs, and the recreate is what the operator asked for.
  return plan.mode === 'src' ? recreate : `(${invocation} pull ${scope} || true) && ${recreate}`;
}

/**
 * The shell script the deploy runs: the command, then the deploy's own report of how it ended.
 *
 * Why the script writes the markers rather than the panel's `close` handler: the marker is the only
 * evidence of an outcome, and the panel can restart — or its container be recreated — while the build
 * runs. The detached child survives that; the handler that was going to write the marker does not, and
 * the deploy would then finish with nothing to record it. The marker paths arrive as `$1`/`$2` (argv,
 * not interpolation) so a repository path containing spaces cannot break the script.
 */
export function buildDeployScript(command: string): string {
  return [
    `(${command})`,
    'code=$?',
    'if [ "$code" -eq 0 ]; then',
    '  printf \'%s\' "$code" > "$1"',
    'else',
    '  printf \'%s\' "$code" > "$2"',
    'fi',
    'exit "$code"',
  ].join('\n');
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

  // The pid is what lets a later process tell "still building" from "gone without a word".
  await patchDeployMeta(operationId, { pid: child.pid });
}

async function finalizeContestActivation(contestId: number): Promise<void> {
  const { activateContest } = await import('@/app/actions/contests');
  const result = await activateContest(contestId);
  if (!result.success) throw new Error(result.error ?? 'activateContest failed');
}

/**
 * Applies a deploy docker reported as successful: the contest is activated — the only place DB
 * is_active moves — and the operation is marked settled so no later lookup activates or notifies
 * twice.
 *
 * Why an activation failure leaves the operation unsettled: `.done` is on disk, so the next lookup
 * retries the activation instead of losing it. Nothing is reverted either: the containers already run
 * this contest, and reverting the configuration would make it disagree with them.
 */
async function settleCompletedDeploy(operationId: string, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);
  const base = { contestId: meta.contestId, startedAt: meta.startedAt, log, percent };
  try {
    await finalizeContestActivation(meta.contestId);
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      ...base,
      error: `Deploy completed but contest activation failed: ${(error as Error).message}`,
    };
  }
  await patchDeployMeta(operationId, { outcome: { status: 'completed' } });
  await clearActiveOperation();
  await logToDiscord('Contest Deploy Completed', `Contest ID **${meta.contestId}** deployed successfully.`, 3066993);
  return { success: true, status: 'completed', ...base };
}

/**
 * Applies a deploy that did not complete, and is the only place `config.toml` is reverted.
 *
 * Why only here: a revert contradicts the running containers the moment the deploy did succeed, which
 * is how the panel ended up with configuration, database and containers asserting three different
 * contests. So a revert waits for evidence that there is no success to lose — a non-zero exit docker
 * reported, or a process gone without reporting at all. A watch timing out is not that evidence.
 */
async function settleFailedDeploy(operationId: string, meta: DeployMeta, log: string, error: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);
  const rollbackFailure = await rollbackContestId(meta);
  const warning = rollbackFailure ?? undefined;
  await patchDeployMeta(operationId, { outcome: { status: 'failed', error, warning } });
  await clearActiveOperation();
  await logToDiscord('Contest Deploy Failed', `Contest ID **${meta.contestId}**: ${error}`, 15158332, true);
  return { success: false, status: 'failed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error, warning };
}

/**
 * Puts the configuration back on the contest this operation replaced — but only while the file still
 * holds the contest this operation set.
 *
 * Why the condition: a revert is only correct while this operation is the file's last writer. A
 * `config.toml` that already names another contest belongs to a newer deploy, and reverting it would
 * leave the file and the database asserting different contests — the split this path exists to avoid.
 */
async function rollbackContestId(meta: DeployMeta): Promise<string | null> {
  if (meta.previousContestId === undefined) return null;
  const current = await readConfigTomlContestId();
  if (current === null) return 'Could not read CONTEST_ID from config.toml during rollback.';
  if (current !== meta.contestId) return null;
  try {
    await updateConfigTomlContestId(meta.previousContestId);
    await runConfigSync();
    return null;
  } catch (error) {
    return `Rollback to contest #${meta.previousContestId} failed: ${(error as Error).message}`;
  }
}

/** The status of an operation whose outcome the panel has already applied; repeats no side effect. */
function settledStatus(meta: DeployMeta, log: string, outcome: DeployOutcome): DeployStatusResult {
  const base = { contestId: meta.contestId, startedAt: meta.startedAt, log, percent: parseDeployPercent(log) };
  return outcome.status === 'completed'
    ? { success: true, status: 'completed', ...base }
    : { success: false, status: 'failed', ...base, error: outcome.error, warning: outcome.warning };
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
 */
async function resolveDeployStatus(operationId: string, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  if (meta.outcome) return settledStatus(meta, log, meta.outcome);

  const paths = getDeployOperationPaths(operationId);
  if (await fileExists(paths.donePath)) return settleCompletedDeploy(operationId, meta, log);

  const errorContent = await fs.readFile(paths.errorPath, 'utf-8').catch(() => null);
  if (errorContent !== null) {
    return settleFailedDeploy(operationId, meta, log, `Docker process exited with code ${errorContent.trim()}.`);
  }

  if (meta.pid !== undefined) {
    if (await isDeployProcessAlive(meta.pid)) return runningStatus(meta, log);
    // Gone and silent: its result never arrived, so nothing it did can be trusted. Nobody is working.
    return settleFailedDeploy(operationId, meta, log, 'Deploy process is gone without reporting a result.');
  }

  // No process recorded (a record written by an older panel). Existence cannot be checked, so the
  // stale bound decides, and it is deliberately generous: being wrong here reverts a live deploy.
  if (Date.now() - new Date(meta.startedAt).getTime() > DEPLOY_STALE_MS) {
    return settleFailedDeploy(operationId, meta, log, `Deploy gave no result within ${DEPLOY_STALE_LABEL}.`);
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
  for (const { operationId, meta } of await listDeployOperations()) {
    // fetchDeployStatus is the one resolution rule; reconciliation only applies it to every record.
    if (!meta.outcome) await fetchDeployStatus(operationId);
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
      // Nothing was started, so there is no work to observe: give back the guard and the contest id.
      await clearActiveOperation().catch(() => {});
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

export function getDeployOperationPathsForApi(operationId: string): DeployPaths {
  return getDeployOperationPaths(operationId);
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
