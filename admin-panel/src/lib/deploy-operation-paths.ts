import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { getRepoRoot } from '@/lib/repo-root';

/** The four files one operation's lifecycle is recorded in. */
export type DeployOperationPaths = {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
};

export const getDeployLogsDir = (): string => path.join(getRepoRoot(), 'logs', 'deploy');

export async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

export function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function getDeployOperationPaths(operationId: string): DeployOperationPaths {
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

/**
 * Frees the deploy guard — and only while it is still this operation's.
 *
 * Why the check: the guard is what keeps a second deploy's `config.toml` write out of the one that is
 * settling, and every path that finishes with an operation releases it (the completed and failed settles,
 * a lookup that reports an outcome whose effects already ran, the spawn that never started, the cleanup).
 * Without the check, a settle of an operation the guard has already moved past unlinks the *newer*
 * operation's lock — after which that deploy can start while this one is still inside the read-then-write
 * window of its own revert (see deploy-store's `revertOwnedContestId`), and its write is reverted to this
 * operation's snapshot.
 *
 * What this does not close: the read and the unlink are two filesystem calls, so a caller that reads
 * "the guard is mine" and loses it before the unlink still removes a newer operation's lock. No
 * primitive here takes and releases the lock in one operation, and the writer that could win in
 * between is another panel process (see `withMetaMutation`), not a concurrent request in this one.
 */
export async function clearActiveOperation(operationId: string): Promise<void> {
  if ((await getActiveOperationId()) !== operationId) return;
  await fs.unlink(path.join(getDeployLogsDir(), 'active.lock')).catch(() => {});
}
