'use server';

import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { logToDiscord } from '@/lib/discord-notifier';
import {
  analyzeContainerDependencies as analyzeContainerDependenciesLib,
  buildRestartCommand,
  getRestartPolicies,
} from '@/lib/restart-planner';
import {
  runDeployContest,
  fetchDeployStatus,
} from '@/lib/deploy-operations';
import type {
  DeployContestResult,
  DeployStatusResult,
} from '@/lib/deploy-operations';

const execPromise = util.promisify(exec);

async function getContestComposeFile(): Promise<string> {
    return 'docker-compose.contest.yml';
}

// Why: client components must not import the fs-backed planner directly —
// Turbopack bundles client imports for the browser and cannot resolve
// node:fs. Exposed as a server action (permission-gated like its siblings).
export async function analyzeContainerDependencies(containerNames: string[]): Promise<string[]> {
    await ensurePermission('all');
    return analyzeContainerDependenciesLib(containerNames);
}

export async function analyzeRestartRequirements(changedKeys: string[]) {
    await ensurePermission('all');
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
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    await execPromise('make env', { cwd: rootDir });

    const contestComposeFile = await getContestComposeFile();
    const files = [
      'docker-compose.core.yml',
      'docker-compose.admin.yml',
      'docker-compose.worker.yml',
      contestComposeFile,
      'docker-compose.monitor.yml'
    ].map(f => `-f ${f}`).join(' ');

    const plan = await buildRestartCommand(type, customList, files);
    if (plan.skip) return { success: true, message: plan.message };

    await logToDiscord('Service Restart', `Admin triggered restart: **${type}** ${customList ? `(${customList.join(', ')})` : ''}`, 16753920, true);

    const { stdout, stderr } = await execPromise(plan.command, { cwd: rootDir, timeout: 120000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    return { success: true, message: `Services (${type}) restarted.`, output: stdout };
  } catch (error) {
    console.error('Restart error:', error);
    return { success: false, error: (error as Error).message };
  }
}

/** @deprecated Use deployContest() instead for async, non-blocking deploys. */
export async function saveAndRestartContest(contestId: number) {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    const { writeActiveContestId } = await import('./env');
    const result = await writeActiveContestId(contestId);
    if (!result.success) return { success: false, error: 'Failed to update contest env file' };

    const cmd = `docker compose -f docker-compose.contest.yml up -d --build --force-recreate`;

    await logToDiscord('Contest Restart', `Admin activated contest ID **${contestId}** and restarted contest stack.`, 16753920, true);

    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir, timeout: 120000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    return { success: true, message: `Contest ${contestId} activated and stack restarted.`, output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function deployContest(contestId: number): Promise<DeployContestResult> {
  await ensurePermission('all');
  return runDeployContest(contestId);
}

export async function getDeployStatus(operationId: string): Promise<DeployStatusResult> {
  await ensurePermission('all');
  return fetchDeployStatus(operationId);
}

export async function triggerManualBackup() {
    await ensurePermission('all');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Manual Backup', 'Admin triggered a manual submissions backup.', 3447003);
        const cmd = 'docker exec -d cms-monitor bash /usr/local/bin/cms-backup.sh';
        await execPromise(cmd, { cwd: rootDir });
        return { success: true, message: 'Backup process started in background.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export async function getServiceStatus() {
    await ensurePermission('all');
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
    await ensurePermission('all');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Server Update', 'Admin triggered a server update.', 16753920, true);

        const cmd = `nohup ${path.join(rootDir, 'scripts/__update-server.sh')} > ${path.join(rootDir, 'update.log')} 2>&1 &`;
        await execPromise(cmd);

        return { success: true, message: 'Server update started in background. Check logs or wait a few minutes.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}
