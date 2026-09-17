'use server';

import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { resolveHostComposeLocation } from '@/lib/compose-location';
import { logToDiscord } from '@/lib/discord-notifier';
import { recordAudit } from '@/lib/audit';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import type { DeploymentModeSetting } from '@/lib/deployment-mode';
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

    // Why: inside the panel container the repo is the /repo-root bind mount, so relative bind
    // sources in docker-compose.yml would resolve to a host path the daemon does not have. Compose
    // has to be told the host repository directory instead. Resolved once per restart and threaded
    // through the planner like files/mode. On the host the resolution is null and the command is
    // left as before; when it cannot be determined we refuse rather than compose against a guess.
    const location = await resolveHostComposeLocation();
    if (!location.ok) {
      return { success: false, error: location.error };
    }

    const plan = await buildRestartCommand(type, customList, files, (await readDeploymentModeSetting()).mode, location.location);
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

  // Why the deploy resolves the same three things a restart does: the contest stack is the same
  // project the make targets run, so it is brought up from the same file list, with the same
  // deployment mode deciding pull + --no-build versus --build, and with the host repository path
  // compose needs when this panel runs inside its container (see lib/compose-location.ts). Refusing
  // an undeterminable location for the same reason as a restart: a wrong project directory mounts and
  // builds the wrong files instead of failing.
  const location = await resolveHostComposeLocation();
  if (!location.ok) return { success: false, error: location.error };

  const result = await runDeployContest(contestId, {
    files: await buildComposeFileFlags(),
    mode: (await readDeploymentModeSetting()).mode,
    location: location.location,
  });
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
