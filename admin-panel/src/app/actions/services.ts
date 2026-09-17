'use server';

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import { recordAudit } from '@/lib/audit';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { parseDeploymentMode, type DeploymentModeSetting } from '@/lib/deployment-mode';
import {
  analyzeContainerDependencies as analyzeContainerDependenciesLib,
  buildComposeFileFlags,
  buildRestartCommand,
  getRestartPolicies,
} from '@/lib/restart-planner';
import {
  runDeployContest,
  fetchDeployStatus,
  getActiveDeployOperation as getActiveDeployOperationLib,
} from '@/lib/deploy-operations';
import type {
  ActiveDeployOperation,
  DeployContestResult,
  DeployStatusResult,
} from '@/lib/deploy-operations';

const execPromise = util.promisify(exec);

/**
 * Reads the mode from config.toml — the source of truth — and not from process.env, which only
 * carries the value a previous `./cms config sync` copied in and can therefore lag an edit.
 * A missing file is the same "cannot be determined" case as an unknown value and both fall back
 * to img, the mode that does not rebuild (see deployment-mode.ts).
 */
async function readDeploymentModeSetting(): Promise<DeploymentModeSetting> {
    const content = await fs
        .readFile(path.join(getRepoRoot(), CONFIG_TOML_FILE), 'utf-8')
        .catch(() => null);
    return parseDeploymentMode(content);
}

/**
 * The mode the next restart uses, so the operator can see what that restart does before running it.
 * Gated like the rest of the read-only service surface: this decides whether a restart pulls or rebuilds.
 */
export async function getDeploymentMode(): Promise<DeploymentModeSetting> {
    await ensurePermission('service:read');
    return readDeploymentModeSetting();
}

// Why: client components must not import the fs-backed planner directly —
// Turbopack bundles client imports for the browser and cannot resolve
// node:fs. Exposed as a server action (permission-gated like its siblings).
export async function analyzeContainerDependencies(containerNames: string[]): Promise<string[]> {
    await ensurePermission('container:read');
    return analyzeContainerDependenciesLib(containerNames);
}

export async function analyzeRestartRequirements(changedKeys: string[]) {
    await ensurePermission('service:read');
    const policies = await getRestartPolicies();
    if (!policies) return { requiredRestarts: [] };

    const initialSet = new Set<string>();

    for (const key of changedKeys) {
        if (key === 'CONTESTS_DEPLOY_CONFIG') {
            initialSet.add('contest-stack');
            continue;
        }
        policies.env_triggers[key]?.forEach(s => initialSet.add(s));
    }

    const finalSet = new Set(initialSet);
    const queue = Array.from(initialSet);

    while (queue.length > 0) {
        const current = queue.shift()!;
        const dependents = policies.dependencies[current];
        if (dependents) {
            for (const dep of dependents) {
                if (!finalSet.has(dep)) {
                    finalSet.add(dep);
                    queue.push(dep);
                }
            }
        }
    }

    return { requiredRestarts: Array.from(finalSet) };
}

export async function restartServices(type: 'all' | 'core' | 'admin' | 'worker' | 'custom', customList?: string[]) {
  await ensurePermission('service:restart');
  try {
    const rootDir = getRepoRoot();
    await execPromise('make env', { cwd: rootDir });

    // Why: the restart runs the same project the make targets and ./cms deploy. The partial stack
    // files declare locally-built image names (cms-monitor, cms-admin-panel-next) that no registry
    // serves, so an image-mode pull against them can only fail.
    const files = await buildComposeFileFlags();

    const plan = await buildRestartCommand(type, customList, files, (await readDeploymentModeSetting()).mode);
    if (plan.skip) return { success: true, message: plan.message };

    await logToDiscord('Service Restart', `Admin triggered restart: **${type}** ${customList ? `(${customList.join(', ')})` : ''}`, 16753920, true);

    const { stdout, stderr } = await execPromise(plan.command, { cwd: rootDir, timeout: 120000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    await recordAudit({
      verb: 'service:restart',
      entity: 'service',
      afterValues: { type, customList: customList ?? null },
      result: 'success',
    });
    return { success: true, message: `Services (${type}) restarted.`, output: stdout };
  } catch (error) {
    console.error('Restart error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function deployContest(contestId: number): Promise<DeployContestResult> {
  await ensurePermission('deployment:deploy');
  const result = await runDeployContest(contestId);
  if (result.success) {
    await recordAudit({
      verb: 'deployment:deploy',
      entity: 'deployment',
      entityId: String(contestId),
      afterValues: { contestId },
      result: 'success',
    });
  }
  return result;
}

export async function getDeployStatus(operationId: string): Promise<DeployStatusResult> {
  await ensurePermission('deployment:read');
  return fetchDeployStatus(operationId);
}

export async function getActiveDeployOperation(): Promise<ActiveDeployOperation | null> {
  await ensurePermission('all:all');
  return getActiveDeployOperationLib();
}

export async function triggerManualBackup() {
    await ensurePermission('maintenance:enable');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Manual Backup', 'Admin triggered a manual submissions backup.', 3447003);
        const cmd = 'docker exec -d cms-monitor bash /usr/local/bin/cms-backup.sh';
        await execPromise(cmd, { cwd: rootDir });
        await recordAudit({
          verb: 'maintenance:enable',
          entity: 'service',
          afterValues: { action: 'backup' },
          result: 'success',
        });
        return { success: true, message: 'Backup process started in background.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getServiceStatus() {
    await ensurePermission('service:read');
    try {
        const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
        if (!stdout.trim()) return { status: 'down' as const, running: 0, total: 0 };

        const lines = stdout.trim().split('\n');
        let running = 0;
        let total = 0;

        for (const line of lines) {
            const parsed = JSON.parse(line);
            const name = parsed.Names || '';
            if (name.startsWith('cms-') || name.includes('cms')) {
                total++;
                if (parsed.State === 'running') running++;
            }
        }

        const status = total === 0 ? 'down' as const
            : running === total ? 'ok' as const
            : running === 0 ? 'down' as const
            : 'degraded' as const;

        return { status, running, total };
    } catch {
        return { status: 'down' as const, running: 0, total: 0 };
    }
}

export async function updateServer() {
    await ensurePermission('service:deploy');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Server Update', 'Admin triggered a server update.', 16753920, true);

        const cmd = `nohup ${path.join(rootDir, 'scripts/__update-server.sh')} > ${path.join(rootDir, 'update.log')} 2>&1 &`;
        await execPromise(cmd);

        await recordAudit({
          verb: 'service:deploy',
          entity: 'service',
          afterValues: { action: 'updateServer' },
          result: 'success',
        });
        return { success: true, message: 'Server update started in background. Check logs or wait a few minutes.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
