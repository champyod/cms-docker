import 'server-only';

import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import util from 'util';

import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { DEPLOY_IDLE_TIMEOUT_LABEL, DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_OPERATION_ID_REGEX, DEPLOY_WALL_TIMEOUT_LABEL, DEPLOY_WALL_TIMEOUT_MS } from '@/lib/constants/deploy';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import { readContestId, setContestId } from '@/lib/active-contest';
import {
  cleanStaleOperations,
  clearActiveOperation,
  ensureDeployLogsDir,
  generateOperationId,
  getActiveOperationId,
  getDeployOperationPaths,
  recordDeployOperationStart,
  updateDeployMeta,
  type DeployMeta,
  type DeployPaths,
} from '@/lib/deploy-operation-store';

const execPromise = util.promisify(exec);

const dockerCompose = ['docker', 'compose', '-f', 'docker-compose.contest.yml', 'up', '-d', '--build', '--force-recreate'];
const CONFIG_SYNC_COMMAND = 'bash scripts/__config_sync.sh';

export type { DeployStatus } from '@/lib/deploy-percent.shared';
export { parseDeployPercent, DEPLOY_IDLE_TIMEOUT_MS } from '@/lib/deploy-percent.shared';

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

async function launchDetachedDeploy(contestId: number, operationId: string): Promise<void> {
  const { logPath, donePath, errorPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(logPath, '', { encoding: 'utf-8' });

  const logStream = fsSync.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(dockerCompose[0], dockerCompose.slice(1), {
    cwd: getRepoRoot(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  child.on('close', (code) => {
    logStream.end();
    // Done/error markers are written only on real process exit; resolveDeployStatus gates on their existence.
    const target = code === 0 ? donePath : errorPath;
    const content = code === 0 ? JSON.stringify({ completedAt: new Date().toISOString() }) : String(code ?? 1);
    fs.writeFile(target, content).catch(() => {});
  });

  child.unref();

  await logToDiscord('Contest Deploy Started', `Admin triggered async deploy for contest ID **${contestId}**. Operation: \`${operationId}\``, 16753920, true);
}

export async function runDeployContest(contestId: number): Promise<DeployContestResult> {
  try {
    await ensureDeployLogsDir();
    await cleanStaleOperations();
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
    await recordDeployOperationStart(contestId, operationId, previousContestId);

    try {
      await launchDetachedDeploy(contestId, operationId);
    } catch (error) {
      await clearActiveOperation().catch(() => {});
      await updateConfigTomlContestId(previousContestId).catch(() => {});
      return { success: false, error: (error as Error).message };
    }

    return { success: true, operationId };
  } catch (error) {
    await clearActiveOperation().catch(() => {});
    return { success: false, error: (error as Error).message };
  }
}

async function getLogLastChangeMs(paths: DeployPaths, meta: DeployMeta): Promise<number> {
  try {
    return (await fs.stat(paths.logPath)).mtimeMs;
  } catch {
    return new Date(meta.startedAt).getTime();
  }
}

// DB is_active flips only here — after docker reported success, never before.
async function finalizeContestActivation(contestId: number): Promise<void> {
  const { activateContest } = await import('@/app/actions/contests');
  const result = await activateContest(contestId);
  if (!result.success) throw new Error(result.error ?? 'activateContest failed');
}

async function finalizeCompletedDeploy(paths: DeployPaths, meta: DeployMeta, log: string, percent: number | null): Promise<DeployStatusResult> {
  if (!meta.finalized) {
    try {
      await finalizeContestActivation(meta.contestId);
    } catch (error) {
      return { success: false, status: 'failed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: 'Deploy completed but contest activation failed: ' + (error as Error).message };
    }
    await updateDeployMeta(paths.metaPath, meta, { finalized: true });
  }
  await clearActiveOperation();
  await logToDiscord('Contest Deploy Completed', `Contest ID **${meta.contestId}** deployed successfully.`, 3066993);
  return { success: true, status: 'completed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent };
}

type FailureKind = 'failed' | 'wall' | 'idle';

async function rollbackContestId(contestId: number): Promise<string | null> {
  try {
    await updateConfigTomlContestId(contestId);
    await runConfigSync();
    return null;
  } catch (error) {
    return `Rollback to contest #${contestId} failed: ${(error as Error).message}`;
  }
}

async function handleTerminalFailure(paths: DeployPaths, meta: DeployMeta, log: string, percent: number | null, kind: FailureKind, exitCode: string | null): Promise<DeployStatusResult> {
  let warning: string | undefined;
  if (!meta.reverted && meta.previousContestId !== undefined) {
    warning = (await rollbackContestId(meta.previousContestId)) ?? undefined;
    await updateDeployMeta(paths.metaPath, meta, { reverted: true });
  }
  await clearActiveOperation();
  if (kind === 'failed') {
    await logToDiscord('Contest Deploy Failed', `Contest ID **${meta.contestId}** deploy failed. Exit code: ${exitCode}`, 15158332, true);
    return { success: false, status: 'failed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: `Docker process exited with code ${exitCode}.`, warning };
  }
  const message = kind === 'wall' ? `Deploy timed out after ${DEPLOY_WALL_TIMEOUT_LABEL} (wall clock limit).` : `Deploy timed out after ${DEPLOY_IDLE_TIMEOUT_LABEL} without log output.`;
  return { success: false, status: 'timeout', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: message, warning };
}

async function resolveDeployStatus(paths: DeployPaths, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);

  const doneExists = await fs.access(paths.donePath).then(() => true).catch(() => false);
  if (doneExists) return finalizeCompletedDeploy(paths, meta, log, percent);

  const errorContent = await fs.readFile(paths.errorPath, 'utf-8').catch(() => null);
  if (errorContent !== null) return handleTerminalFailure(paths, meta, log, percent, 'failed', errorContent.trim());

  const wallElapsedMs = Date.now() - new Date(meta.startedAt).getTime();
  if (wallElapsedMs > DEPLOY_WALL_TIMEOUT_MS) return handleTerminalFailure(paths, meta, log, percent, 'wall', null);

  const idleMs = Date.now() - (await getLogLastChangeMs(paths, meta));
  if (idleMs > DEPLOY_IDLE_TIMEOUT_MS) return handleTerminalFailure(paths, meta, log, percent, 'idle', null);

  return { success: true, status: 'running', contestId: meta.contestId, startedAt: meta.startedAt, log, percent };
}

export async function fetchDeployStatus(operationId: string): Promise<DeployStatusResult> {
  if (!DEPLOY_OPERATION_ID_REGEX.test(operationId)) return { success: false, status: 'not_found', error: 'Invalid operation ID.' };
  const paths = getDeployOperationPaths(operationId);
  const rawMeta = await fs.readFile(paths.metaPath, 'utf-8').catch(() => null);
  if (rawMeta === null) return { success: false, status: 'not_found', error: 'Operation not found.' };
  const meta = JSON.parse(rawMeta) as DeployMeta;
  const log = await fs.readFile(paths.logPath, 'utf-8').catch(() => '');
  return resolveDeployStatus(paths, meta, log);
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

export async function readDeployMeta(operationId: string): Promise<DeployMeta | null> {
  const raw = await fs.readFile(getDeployOperationPaths(operationId).metaPath, 'utf-8').catch(() => null);
  return raw === null ? null : (JSON.parse(raw) as DeployMeta);
}
