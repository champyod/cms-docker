import 'server-only';

import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import util from 'util';

import { composeLocationFlags, type HostComposeLocation } from '@/lib/compose-location';
import { DEPLOY_OPERATION_ID_REGEX, DEPLOY_STALE_LABEL, DEPLOY_STALE_MS, DEPLOY_UNOBSERVABLE_LABEL } from '@/lib/constants/deploy';
import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import { readContestId, setContestId } from '@/lib/active-contest';
import type { DeploymentMode } from '@/lib/deployment-mode';
import {
  claimDeployOutcome,
  cleanStaleOperations,
  clearActiveOperation,
  ensureDeployLogsDir,
  generateOperationId,
  getActiveOperationId,
  getDeployOperationPaths,
  markDeployOutcomeApplied,
  probeDeployProcess,
  listDeployOperations,
  patchDeployMeta,
  readDeployMeta,
  recordDeployOperationStart,
  recordDeployProcess,
  type DeployMeta,
  type DeployOutcome,
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

/** The configuration file's content, or null when it cannot be read. */
async function readConfigToml(): Promise<string | null> {
  return fs.readFile(getConfigTomlPath(), 'utf-8').catch(() => null);
}

async function readConfigTomlContestId(): Promise<number | null> {
  const content = await readConfigToml();
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
  // Refresh nginx after the web server is recreated (stale upstream DNS).
  // Single source of truth: scripts/__contest_dns_refresh.sh.
  const refreshed = `${recreate} && bash scripts/__contest_dns_refresh.sh`;
  // Best-effort pull, exactly like the Makefile's `pull || true`: the host may already hold the image
  // this deployment runs, and the recreate is what the operator asked for.
  return plan.mode === 'src' ? refreshed : `(${invocation} pull ${scope} || true) && ${refreshed}`;
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

  // The pid is what lets a later process tell "still building" from "gone without a word"; the
  // process table it was spawned in is what keeps that probe answerable after a panel restart.
  await recordDeployProcess(operationId, child.pid);
}

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
async function applyClaimedOutcome(operationId: string, meta: DeployMeta, log: string, outcome: DeployOutcome): Promise<DeployStatusResult> {
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

/** Whether `config.toml` still names `contestId`, or null when the file cannot be read at all. */
async function configTomlNamesContest(contestId: number): Promise<boolean | null> {
  const content = await readConfigToml();
  if (content === null) return null;
  return readContestId(content) === contestId;
}

/**
 * Puts the active contest back to what this operation replaced, changing only the key this operation
 * owns and re-reading the file as close to the write as the design allows.
 *
 * Why the content written is read here rather than taken from the ownership check that preceded it:
 * anything another writer puts in config.toml in between — a webhook or a credential key from
 * `env:update`, which the deploy guard does not gate because only a deploy takes it — would be
 * reverted together with that snapshot, silently and undetectably. What remains is the window between
 * this read and the write below, which the filesystem gives us no way to make one operation: it is one
 * `await` wide, and closing it would take a lock file the whole project would have to honour.
 *
 * Why the ownership condition is repeated on this fresh read: the write is only correct while this
 * operation is the file's last writer. A config.toml that already names another contest belongs to a
 * newer deploy, and reverting it would leave the file and the database asserting different contests —
 * the split this path exists to avoid. Repeating it here is also what keeps the check and the write
 * from spanning an edit: the check before this call is about whether to try at all, this one is about
 * what to write.
 */
async function revertOwnedContestId(expected: number, previous: number): Promise<'reverted' | 'not_ours' | 'unreadable'> {
  const content = await readConfigToml();
  if (content === null) return 'unreadable';
  if (readContestId(content) !== expected) return 'not_ours';
  await fs.writeFile(getConfigTomlPath(), setContestId(content, previous));
  return 'reverted';
}

/**
 * Reverts the configuration for a deploy that will not complete, and skips the revert when the file is
 * no longer this operation's to touch.
 *
 * Why the check before the write: a revert is only correct while this operation is the file's last
 * writer, so the file is read once to decide whether this settle should revert at all — and separately
 * again inside `revertOwnedContestId`, which is the content the write is derived from.
 */
async function rollbackContestId(meta: DeployMeta): Promise<string | null> {
  if (meta.previousContestId === undefined) return null;
  const owned = await configTomlNamesContest(meta.contestId);
  if (owned === null) return 'Could not read CONTEST_ID from config.toml during rollback.';
  if (!owned) return null;
  try {
    const reverted = await revertOwnedContestId(meta.contestId, meta.previousContestId);
    if (reverted === 'unreadable') return 'Could not read CONTEST_ID from config.toml during rollback.';
    // Lost the file to a newer deploy between the two reads: its contest is the one that stands, and
    // the database already agrees with it.
    if (reverted === 'not_ours') return null;
    await runConfigSync();
    return null;
  } catch (error) {
    return `Rollback to contest #${meta.previousContestId} failed: ${(error as Error).message}`;
  }
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
