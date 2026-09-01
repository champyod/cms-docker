import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { getRepoRoot } from './repo-root';
import { logToDiscord } from './discord-notifier';

export interface DeployContestResult {
  success: boolean;
  operationId?: string;
  error?: string;
  alreadyRunning?: boolean;
}

export type DeployStatus = 'running' | 'completed' | 'failed' | 'not_found' | 'timeout';

export interface DeployStatusResult {
  success: boolean;
  status: DeployStatus;
  contestId?: number;
  startedAt?: string;
  log?: string;
  error?: string;
  percent?: number | null;
}

interface DeployPaths {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
}

type DeployMeta = { contestId: number; startedAt: string };

export const DEPLOY_IDLE_TIMEOUT_MS = 60_000;

/**
 * Why idle timeout instead of absolute: docker pull can legitimately take
 * several minutes on a slow link but always appends log lines while progressing.
 * Only lack of log change for 60 seconds indicates a hung process, so we track
 * lastChangeAt from log file modification time rather than start time.
 */
export function parseDeployPercent(log: string): number | null {
  if (!log) return null;
  // Match patterns like "37%", "Pulling ...  37%", "Downloading [====>    ] 37%"
  // Collect all percent occurrences and return the largest seen, which reflects furthest progress.
  const matches = log.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;
  let maximum = 0;
  for (const match of matches) {
    const value = parseInt(match.replace('%', ''), 10);
    if (!Number.isNaN(value) && value >= 0 && value <= 100 && value > maximum) {
      maximum = value;
    }
  }
  return maximum > 0 ? maximum : null;
}

const getDeployLogsDir = () => path.join(getRepoRoot(), 'logs', 'deploy');

async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function getDeployOperationPaths(operationId: string): DeployPaths {
  const logsDir = getDeployLogsDir();
  return {
    metaPath: path.join(logsDir, `${operationId}.json`),
    logPath: path.join(logsDir, `${operationId}.log`),
    donePath: path.join(logsDir, `${operationId}.done`),
    errorPath: path.join(logsDir, `${operationId}.error`),
  };
}

async function getActiveOperationId(): Promise<string | null> {
  try {
    const lockPath = path.join(getDeployLogsDir(), 'active.lock');
    return await fs.readFile(lockPath, 'utf-8');
  } catch {
    return null;
  }
}

async function setActiveOperationId(operationId: string): Promise<void> {
  const lockPath = path.join(getDeployLogsDir(), 'active.lock');
  await fs.writeFile(lockPath, operationId, 'utf-8');
}

async function clearActiveOperation(): Promise<void> {
  const lockPath = path.join(getDeployLogsDir(), 'active.lock');
  await fs.unlink(lockPath).catch(() => {});
}

async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  const STALE_MS = 30 * 60 * 1000;
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    for (const jsonFile of jsonFiles) {
      const filePath = path.join(dir, jsonFile);
      const raw = await fs.readFile(filePath, 'utf-8').catch(() => null);
      if (!raw) continue;
      const meta = JSON.parse(raw) as { startedAt: string };
      const age = Date.now() - new Date(meta.startedAt).getTime();
      if (age > STALE_MS) {
        const opId = jsonFile.replace('.json', '');
        await fs.unlink(path.join(dir, `${opId}.json`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.log`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.done`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.error`)).catch(() => {});
        const active = await getActiveOperationId();
        if (active === opId) await clearActiveOperation();
      }
    }
  } catch {
    // Non-fatal: stale cleanup is best-effort
  }
}

async function prepareContestActivation(contestId: number): Promise<{ ok: true } | { ok: false; error?: string }> {
  const { activateContest } = await import('@/app/actions/contests');
  const activateResult = await activateContest(contestId);
  if (!activateResult.success) {
    return { ok: false, error: activateResult.error };
  }

  const { writeActiveContestId } = await import('@/app/actions/env');
  const envResult = await writeActiveContestId(contestId);
  if (!envResult.success) {
    return { ok: false, error: 'Failed to write .env.contest: ' + envResult.error };
  }

  return { ok: true };
}

async function recordDeployOperationStart(contestId: number, operationId: string): Promise<void> {
  const { metaPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(
    metaPath,
    JSON.stringify({ contestId, startedAt: new Date().toISOString(), status: 'running' }),
    'utf-8'
  );
  await setActiveOperationId(operationId);
}

async function launchDetachedDeploy(contestId: number, operationId: string): Promise<void> {
  const { logPath, donePath, errorPath } = getDeployOperationPaths(operationId);
  const shellCmd = [
    `docker compose -f docker-compose.contest.yml up -d --build --force-recreate`,
    `> "${logPath}" 2>&1`,
    `&& echo "ok" > "${donePath}"`,
    `|| echo "$?" > "${errorPath}"`,
  ].join(' ');

  const child = spawn('sh', ['-c', shellCmd], {
    cwd: getRepoRoot(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  await logToDiscord(
    'Contest Deploy Started',
    `Admin triggered async deploy for contest ID **${contestId}**. Operation: \`${operationId}\``,
    16753920,
    true
  );
}

export async function runDeployContest(contestId: number): Promise<DeployContestResult> {
  try {
    await ensureDeployLogsDir();
    await cleanStaleOperations();

    const existingOp = await getActiveOperationId();
    if (existingOp !== null) {
      return { success: false, alreadyRunning: true, error: 'A deploy is already in progress.' };
    }

    const activation = await prepareContestActivation(contestId);
    if (!activation.ok) {
      return { success: false, error: activation.error };
    }

    const operationId = generateOperationId();
    await recordDeployOperationStart(contestId, operationId);
    await launchDetachedDeploy(contestId, operationId);

    return { success: true, operationId };
  } catch (error) {
    await clearActiveOperation().catch(() => {});
    return { success: false, error: (error as Error).message };
  }
}

async function getLogLastChangeMs(paths: DeployPaths, meta: DeployMeta): Promise<number> {
  try {
    const stat = await fs.stat(paths.logPath);
    return stat.mtimeMs;
  } catch {
    return new Date(meta.startedAt).getTime();
  }
}

async function resolveDeployStatus(paths: DeployPaths, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);

  const isDone = await fs.access(paths.donePath).then(() => true).catch(() => false);
  if (isDone) {
    await clearActiveOperation();
    await logToDiscord('Contest Deploy Completed', `Contest ID **${meta.contestId}** deployed successfully.`, 3066993);
    return { success: true, status: 'completed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent };
  }

  const errorContent = await fs.readFile(paths.errorPath, 'utf-8').catch(() => null);
  if (errorContent !== null) {
    await clearActiveOperation();
    await logToDiscord('Contest Deploy Failed', `Contest ID **${meta.contestId}** deploy failed. Exit code: ${errorContent.trim()}`, 15158332, true);
    return { success: false, status: 'failed', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: `Docker process exited with code ${errorContent.trim()}.` };
  }

  // Why idle 60 seconds from last log change: absolute 120 seconds would kill slow but progressing docker pulls; idle detection ensures timeout only when no output arrives, proving the process is hung.
  const lastChangeMs = await getLogLastChangeMs(paths, meta);
  const idleMs = Date.now() - lastChangeMs;
  if (idleMs > DEPLOY_IDLE_TIMEOUT_MS) {
    await clearActiveOperation();
    return { success: false, status: 'timeout', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: `Deploy timed out after 60 seconds without log output.` };
  }

  return { success: true, status: 'running', contestId: meta.contestId, startedAt: meta.startedAt, log, percent };
}

export async function fetchDeployStatus(operationId: string): Promise<DeployStatusResult> {
  if (!/^[0-9a-f]{16}$/.test(operationId)) {
    return { success: false, status: 'not_found', error: 'Invalid operation ID.' };
  }

  const paths = getDeployOperationPaths(operationId);
  const rawMeta = await fs.readFile(paths.metaPath, 'utf-8').catch(() => null);
  if (rawMeta === null) {
    return { success: false, status: 'not_found', error: 'Operation not found.' };
  }

  const meta = JSON.parse(rawMeta) as DeployMeta;
  const log = await fs.readFile(paths.logPath, 'utf-8').catch(() => '');

  return resolveDeployStatus(paths, meta, log);
}

export function getDeployOperationPathsForApi(operationId: string): DeployPaths {
  return getDeployOperationPaths(operationId);
}

export async function readDeployMeta(operationId: string): Promise<DeployMeta | null> {
  const paths = getDeployOperationPaths(operationId);
  const raw = await fs.readFile(paths.metaPath, 'utf-8').catch(() => null);
  if (raw === null) return null;
  return JSON.parse(raw) as DeployMeta;
}
