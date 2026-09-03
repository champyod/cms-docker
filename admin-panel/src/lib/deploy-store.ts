import 'server-only';

import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { parseDeployPercent, type DeployStatus } from '@/lib/deploy-percent.shared';
import { DEPLOY_IDLE_TIMEOUT_MS, DEPLOY_OPERATION_ID_REGEX, DEPLOY_STALE_MS } from '@/lib/constants/deploy';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';

const dockerCompose = ['docker', 'compose', '-f', 'docker-compose.contest.yml', 'up', '-d', '--build', '--force-recreate'];

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
  percent?: number | null;
}

interface DeployPaths {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
}

type DeployMeta = { contestId: number; startedAt: string };

const getDeployLogsDir = (): string => path.join(getRepoRoot(), 'logs', 'deploy');

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
    return await fs.readFile(path.join(getDeployLogsDir(), 'active.lock'), 'utf-8');
  } catch {
    return null;
  }
}

async function setActiveOperationId(operationId: string): Promise<void> {
  await fs.writeFile(path.join(getDeployLogsDir(), 'active.lock'), operationId, 'utf-8');
}

async function clearActiveOperation(): Promise<void> {
  await fs.unlink(path.join(getDeployLogsDir(), 'active.lock')).catch(() => {});
}

async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  try {
    const files = await fs.readdir(dir);
    for (const jsonFile of files.filter((file) => file.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(dir, jsonFile), 'utf-8').catch(() => null);
      if (!raw) continue;
      const meta = JSON.parse(raw) as { startedAt: string };
      if (Date.now() - new Date(meta.startedAt).getTime() > DEPLOY_STALE_MS) {
        const opId = jsonFile.replace('.json', '');
        await fs.unlink(path.join(dir, `${opId}.json`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.log`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.done`)).catch(() => {});
        await fs.unlink(path.join(dir, `${opId}.error`)).catch(() => {});
        if ((await getActiveOperationId()) === opId) await clearActiveOperation();
      }
    }
  } catch {
  }
}

async function prepareContestActivation(contestId: number): Promise<{ ok: true } | { ok: false; error?: string }> {
  const { activateContest } = await import('@/app/actions/contests');
  const activateResult = await activateContest(contestId);
  if (!activateResult.success) return { ok: false, error: activateResult.error };
  const { writeActiveContestId } = await import('@/app/actions/env');
  const envResult = await writeActiveContestId(contestId);
  if (!envResult.success) return { ok: false, error: 'Failed to write .env.contest: ' + envResult.error };
  return { ok: true };
}

async function recordDeployOperationStart(contestId: number, operationId: string): Promise<void> {
  const { metaPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(metaPath, JSON.stringify({ contestId, startedAt: new Date().toISOString(), status: 'running' }), 'utf-8');
  await setActiveOperationId(operationId);
}

async function launchDetachedDeploy(contestId: number, operationId: string): Promise<void> {
  const { logPath, donePath, errorPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(logPath, '', { encoding: 'utf-8' });
  await fs.writeFile(donePath, '', { encoding: 'utf-8' });
  await fs.writeFile(errorPath, '', { encoding: 'utf-8' });
  execFile(dockerCompose[0], dockerCompose.slice(1), { cwd: getRepoRoot(), detached: true } as { cwd: string; detached: boolean });
  await logToDiscord('Contest Deploy Started', `Admin triggered async deploy for contest ID **${contestId}**. Operation: \`${operationId}\``, 16753920, true);
}

export async function runDeployContest(contestId: number): Promise<DeployContestResult> {
  try {
    await ensureDeployLogsDir();
    await cleanStaleOperations();
    if ((await getActiveOperationId()) !== null) return { success: false, alreadyRunning: true, error: 'A deploy is already in progress.' };
    const activation = await prepareContestActivation(contestId);
    if (!activation.ok) return { success: false, error: activation.error };
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
    return (await fs.stat(paths.logPath)).mtimeMs;
  } catch {
    return new Date(meta.startedAt).getTime();
  }
}

async function resolveDeployStatus(paths: DeployPaths, meta: DeployMeta, log: string): Promise<DeployStatusResult> {
  const percent = parseDeployPercent(log);
  if (await fs.access(paths.donePath).then(() => true).catch(() => false)) {
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
  const idleMs = Date.now() - (await getLogLastChangeMs(paths, meta));
  if (idleMs > DEPLOY_IDLE_TIMEOUT_MS) {
    await clearActiveOperation();
    return { success: false, status: 'timeout', contestId: meta.contestId, startedAt: meta.startedAt, log, percent, error: 'Deploy timed out after 60 seconds without log output.' };
  }
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

export async function readDeployMeta(operationId: string): Promise<DeployMeta | null> {
  const raw = await fs.readFile(getDeployOperationPaths(operationId).metaPath, 'utf-8').catch(() => null);
  return raw === null ? null : (JSON.parse(raw) as DeployMeta);
}
