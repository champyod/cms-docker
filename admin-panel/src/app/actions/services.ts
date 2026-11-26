'use server';

import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { resolveHostComposeLocation } from '@/lib/compose-location';
import { logToDiscord } from '@/lib/discord-notifier';
import { recordAudit } from '@/lib/audit';
import { normalizeRestartReason } from '@/lib/restart-reason';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import type { DeploymentModeSetting } from '@/lib/deployment-mode';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import {
  analyzeContainerDependencies as analyzeContainerDependenciesLib,
  buildComposeFileFlags,
  buildRestartCommand,
  getRestartPolicies,
} from '@/lib/restart-planner';

const execPromise = util.promisify(exec);

/** The mode the next restart uses; gated because it decides whether that restart pulls or rebuilds. */
export async function getDeploymentMode(): Promise<DeploymentModeSetting> {
    await ensurePermission('service:read');
    const setting = await readDeploymentModeSetting();
    // Entity 'config', not 'deployment': it reads config.toml [admin] DEPLOYMENT_TYPE.
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      afterValues: { file: CONFIG_TOML_FILE, requestedKeys: ['admin.DEPLOYMENT_TYPE'], resolved: setting.resolved },
      result: 'success',
    });
    return setting;
}

// Client components cannot import the fs-backed planner: Turbopack cannot resolve node:fs for the browser.
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

type RestartServicesResult =
  | { readonly success: true; readonly message: string; readonly output?: string }
  | { readonly success: false; readonly error: string };

export async function restartServices(
  type: 'all' | 'core' | 'admin' | 'worker' | 'custom',
  customList: string[] | undefined,
  reason: string,
): Promise<RestartServicesResult> {
  await ensurePermission('service:restart');

  // Refused here too: the panel also restarts from paths that ask nobody.
  const justification = normalizeRestartReason(reason);
  if (!justification.ok) return { success: false, error: justification.error };

  try {
    const rootDir = getRepoRoot();
    await execPromise('make env', { cwd: rootDir });

    // The partial stack files name locally-built images, so an image-mode pull against them cannot work.
    const files = await buildComposeFileFlags();

    // In the panel container the repo is a bind mount, so compose needs the host path; refuse if unknown.
    const location = await resolveHostComposeLocation();
    if (!location.ok) {
      return { success: false, error: location.error };
    }

    const plan = await buildRestartCommand(type, customList, files, (await readDeploymentModeSetting()).mode, location.location);
    if (plan.skip) return { success: true, message: plan.message };

    await logToDiscord('Service Restart', `Admin triggered restart: **${type}** ${customList ? `(${customList.join(', ')})` : ''}\nReason: ${justification.reason}`, 16753920, true);

    const { stdout, stderr } = await execPromise(plan.command, { cwd: rootDir, timeout: 120000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr };
    }

    await recordAudit({
      verb: 'service:restart',
      entity: 'service',
      afterValues: { type, customList: customList ?? null, reason: justification.reason },
      result: 'success',
    });
    return { success: true, message: `Services (${type}) restarted.`, output: stdout };
  } catch (error) {
    console.error('Restart error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getServiceStatus() {
    await ensurePermission('service:read');
    await ensurePermission('service:list');
    try {
        const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
        const summary = summariseCmsContainers(stdout);
        // Counts, not container names: the caller is about to see the list anyway.
        await recordAudit({
            verb: 'service:view',
            entity: 'service',
            afterValues: { status: summary.status, running: summary.running, total: summary.total },
            result: 'success',
        });
        return summary;
    } catch (error) {
        await recordAudit({
            verb: 'service:view',
            entity: 'service',
            afterValues: { error: error instanceof Error ? error.name : 'UnknownError' },
            result: 'failure',
        });
        return { status: 'down' as const, running: 0, total: 0 };
    }
}

type ServiceStatusSummary = { status: 'ok' | 'degraded' | 'down'; running: number; total: number };

function summariseCmsContainers(stdout: string): ServiceStatusSummary {
    if (!stdout.trim()) return { status: 'down', running: 0, total: 0 };

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

    const status = total === 0 ? 'down'
        : running === total ? 'ok'
        : running === 0 ? 'down'
        : 'degraded';

    return { status, running, total };
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
