'use server';

import fs from 'fs/promises';
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
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
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
  reconcileDeployOperations as reconcileDeployOperationsLib,
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
    const setting = await readDeploymentModeSetting();
    // Why entity config rather than deployment: what this reads is config.toml's
    // [admin] DEPLOYMENT_TYPE, the same key updateConfigTomlValues writes, so the view row lands
    // on the entity the edit that would change it also uses. Keys and the resolved flag only.
    await recordAudit({
      verb: 'config:view',
      entity: 'config',
      afterValues: { file: CONFIG_TOML_FILE, requestedKeys: ['admin.DEPLOYMENT_TYPE'], resolved: setting.resolved },
      result: 'success',
    });
    return setting;
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
  const result = await fetchDeployStatus(operationId);
  // Why the status but not the rest: the returned log and error carry compose output verbatim,
  // so the row names the operation, its state and its contest and stops there.
  await recordAudit({
    verb: 'deployment:view',
    entity: 'deployment',
    entityId: operationId,
    afterValues: { operationId, status: result.status, contestId: result.contestId ?? null },
    result: 'success',
  });
  return result;
}

/**
 * Applies the outcome of any deploy whose effects are still owed, so a visit to the deploy page reaches
 * the state that deploy actually left — the contest activated, or the configuration rolled back —
 * without a client having watched the operation to its end. Reuses the same settle the deploy's own
 * start runs (`reconcileDeployOperations`), which is what keeps it from double-applying an outcome: the
 * operation's record holds the claim and whether its effects landed.
 *
 * Why the deploy page's own permission rather than a mutation key: this is the deploy the operator
 * already ran reaching its end, not a new action, so whoever may look at the deploy page may let it
 * finish. Why a server action and not the page's render: settling activates a contest, and that
 * activation revalidates cached pages — which Next.js refuses from inside a render.
 */
export async function settleDeployOperations(): Promise<void> {
  await ensurePermission('deployment:list');
  await reconcileDeployOperationsLib();
}

export async function getActiveDeployOperation(): Promise<ActiveDeployOperation | null> {
  await ensurePermission('deployment:read');
  const active = await getActiveDeployOperationLib();
  // A null result is a real answer (nothing in flight) and is recorded as one, so a page that
  // keeps asking for a live deploy leaves the same trail whichever way it came back.
  await recordAudit({
    verb: 'deployment:view',
    entity: 'deployment',
    entityId: active?.operationId,
    afterValues: { operationId: active?.operationId ?? null, contestId: active?.contestId ?? null },
    result: 'success',
  });
  return active;
}

export async function triggerManualBackup() {
    // Strict own key: no fallback to maintenance:enable. Re-seed
    // (prisma-sync) grants backup:create to Storage Admin and Superadmin.
    await ensurePermission('backup:create');
    try {
        const rootDir = getRepoRoot();
        await logToDiscord('Manual Backup', 'Admin triggered a manual submissions backup.', 3447003);
        const cmd = 'docker exec -d cms-monitor bash /usr/local/bin/cms-backup.sh';
        await execPromise(cmd, { cwd: rootDir });
        await recordAudit({
          verb: 'backup:create',
          entity: 'service',
          afterValues: { action: 'backup' },
          result: 'success',
        });
        return { success: true, message: 'Backup process started in background.' };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

export interface BackupArchive {
  name: string;
  sizeBytes: number;
  modifiedIso: string;
}

const MAX_ARCHIVES = 200;

// Strict own key. Names come from the filesystem and are display-only;
// no archive is ever executed or interpolated into a shell command here.
export async function listBackups(): Promise<{ success: boolean; archives?: BackupArchive[]; error?: string }> {
    await ensurePermission('backup:list');
    const dir = process.env.BACKUP_DIR ?? path.join(getRepoRoot(), 'backups');
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return { success: true, archives: [] };
    }
    const archives: BackupArchive[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^[A-Za-z0-9._-]+\.(tar\.gz|tgz|sql|sql\.gz|dump|gpg)$/.test(entry.name)) continue;
      try {
        const stat = await fs.stat(path.join(dir, entry.name));
        archives.push({ name: entry.name, sizeBytes: stat.size, modifiedIso: stat.mtime.toISOString() });
      } catch {
        continue;
      }
    }
    archives.sort((a, b) => (a.modifiedIso < b.modifiedIso ? 1 : -1));
    return { success: true, archives: archives.slice(0, MAX_ARCHIVES) };
}

export async function getServiceStatus() {
    await ensurePermission('service:read');
    await ensurePermission('service:list');
    try {
        const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
        const summary = summariseCmsContainers(stdout);
        // Why counts and not names: the row answers "who looked at the stack's health", and the
        // container list it would otherwise carry is what the caller is about to see anyway.
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
