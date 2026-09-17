import 'server-only';

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { DEPLOY_STALE_MS } from '@/lib/constants/deploy';
import { getRepoRoot } from '@/lib/repo-root';

export interface DeployPaths {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
}

/** The result the panel has already applied to an operation, with the copy it reported at the time. */
export interface DeployOutcome {
  status: 'completed' | 'failed';
  error?: string;
  warning?: string;
}

export type DeployMeta = {
  contestId: number;
  startedAt: string;
  previousContestId?: number;
  /**
   * The process running the deploy, as spawned by the panel. Absent only for a record whose process
   * the panel never saw — a record written by an older panel, or a spawn that reported no pid.
   */
  pid?: number;
  /**
   * Set once the outcome has been applied. Why on disk and not in memory: the settling has external
   * effects (activating a contest, reverting config.toml, notifying Discord) that must not happen
   * twice, and the panel that settles may not be the one that started the deploy.
   */
  outcome?: DeployOutcome;
};

export interface DeployOperation {
  operationId: string;
  meta: DeployMeta;
}

const getDeployLogsDir = (): string => path.join(getRepoRoot(), 'logs', 'deploy');

export async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

export function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function getDeployOperationPaths(operationId: string): DeployPaths {
  const logsDir = getDeployLogsDir();
  return {
    metaPath: path.join(logsDir, `${operationId}.json`),
    logPath: path.join(logsDir, `${operationId}.log`),
    donePath: path.join(logsDir, `${operationId}.done`),
    errorPath: path.join(logsDir, `${operationId}.error`),
  };
}

export async function getActiveOperationId(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(getDeployLogsDir(), 'active.lock'), 'utf-8');
  } catch {
    return null;
  }
}

export async function setActiveOperationId(operationId: string): Promise<void> {
  await fs.writeFile(path.join(getDeployLogsDir(), 'active.lock'), operationId, 'utf-8');
}

export async function clearActiveOperation(): Promise<void> {
  await fs.unlink(path.join(getDeployLogsDir(), 'active.lock')).catch(() => {});
}

export async function readDeployMeta(operationId: string): Promise<DeployMeta | null> {
  const raw = await fs.readFile(getDeployOperationPaths(operationId).metaPath, 'utf-8').catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DeployMeta;
  } catch {
    return null;
  }
}

/** Records the start of an operation and claims the guard in one step, before any work runs. */
export async function recordDeployOperationStart(operationId: string, meta: DeployMeta): Promise<void> {
  await fs.writeFile(getDeployOperationPaths(operationId).metaPath, JSON.stringify(meta), 'utf-8');
  await setActiveOperationId(operationId);
}

/**
 * Merges into the record on disk instead of writing a caller's copy of it.
 *
 * Why: the panel patches the same operation from several places — the spawn adds its pid while a
 * watcher may be writing the outcome, and the settling flags must survive either write. Writing a
 * stale whole object would silently drop the other writer's field.
 */
export async function patchDeployMeta(operationId: string, patch: Partial<DeployMeta>): Promise<void> {
  const meta = await readDeployMeta(operationId);
  if (meta === null) return;
  await fs.writeFile(getDeployOperationPaths(operationId).metaPath, JSON.stringify({ ...meta, ...patch }), 'utf-8');
}

/** Every operation record the panel still holds. Records are independent, so order carries no meaning. */
export async function listDeployOperations(): Promise<DeployOperation[]> {
  const dir = getDeployLogsDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const operations: DeployOperation[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const operationId = file.slice(0, -'.json'.length);
    const meta = await readDeployMeta(operationId);
    if (meta !== null) operations.push({ operationId, meta });
  }
  return operations;
}

/** Marks our own command in a pid's argv, so a recycled pid cannot pass itself off as the deploy. */
const DEPLOY_COMMAND_MARKER = 'docker';

/**
 * Whether the process this operation recorded is still running.
 *
 * Why the process at all: elapsed time and log silence cannot tell a working deploy from a dead one —
 * docker build spends minutes between output lines, and a full `up --build` can legitimately outlast
 * any clock we pick. The process exiting is what ends a deploy (and is what writes its marker).
 *
 * Why the argv check on top of `kill(pid, 0)`: a pid only means something inside the process table
 * that issued it. After the panel's container restarts, a recorded pid can belong to an unrelated
 * process — a bare existence probe would then keep a finished operation "running" indefinitely. A pid
 * that exists but does not carry this command is therefore not ours. An unreadable /proc (a host
 * without one) leaves existence as the only available evidence, which errs towards "still working":
 * the operation then keeps its guard and is settled when that pid goes away.
 */
export async function isDeployProcessAlive(pid: number | undefined): Promise<boolean> {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  const commandLine = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null);
  if (commandLine === null) return true;
  return commandLine.includes(DEPLOY_COMMAND_MARKER);
}

/**
 * Discards the records the panel has finished with.
 *
 * Why after settling and never while a process is alive: deleting a record is what forgets an
 * operation, so a record of a deploy that is still building — or one whose result has not been
 * applied yet — must survive. Reconciliation (deploy-store) settles first, which leaves only settled
 * records and operations with no process left to wait for.
 */
export async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const jsonFile of files.filter((file) => file.endsWith('.json'))) {
    const operationId = jsonFile.replace('.json', '');
    const meta = await readDeployMeta(operationId);
    if (meta === null) continue;
    if (Date.now() - new Date(meta.startedAt).getTime() <= DEPLOY_STALE_MS) continue;
    if (await isDeployProcessAlive(meta.pid)) continue;
    await fs.unlink(path.join(dir, `${operationId}.json`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.log`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.done`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.error`)).catch(() => {});
    if ((await getActiveOperationId()) === operationId) await clearActiveOperation();
  }
}
