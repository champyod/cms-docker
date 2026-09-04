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

export type DeployMeta = {
  contestId: number;
  startedAt: string;
  previousContestId?: number;
  finalized?: boolean;
  reverted?: boolean;
};

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

export async function cleanStaleOperations(): Promise<void> {
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

export async function recordDeployOperationStart(contestId: number, operationId: string, previousContestId: number): Promise<void> {
  const { metaPath } = getDeployOperationPaths(operationId);
  await fs.writeFile(metaPath, JSON.stringify({ contestId, startedAt: new Date().toISOString(), previousContestId }), 'utf-8');
  await setActiveOperationId(operationId);
}

export async function updateDeployMeta(metaPath: string, meta: DeployMeta, patch: Partial<DeployMeta>): Promise<void> {
  await fs.writeFile(metaPath, JSON.stringify({ ...meta, ...patch }), 'utf-8').catch(() => {});
}
