'use server';

import { ensurePermission } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { writeFile } from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import { CONTAINER_ID_RE } from '@/lib/container-probes';
import {
  containerRestartConfigPath,
  readContainerRestartConfig,
  type ContainerRestartConfig,
} from '@/lib/container-restart-store';

const execPromise = util.promisify(exec);

const RESTART_POLICY_RE = /^(?:no|always|unless-stopped|on-failure:(?:[0-9]|1[0-9]|20))$/;

// Why re-exported: the containers stream sends this shape with every snapshot, and the components
// that render it keep importing it from where they always did.
export type { ContainerRestartConfig };

/**
 * Why the read is audited: restart policy is what decides whether a container comes back on its
 * own, so who looked at it is part of the answer to "who changed the restart behaviour". The row
 * carries container ids only — the config holds no credentials, and a view log that echoed values
 * would train the log to be treated as a values store.
 */
export async function getContainerConfig(): Promise<ContainerRestartConfig> {
  await ensurePermission('container:read');
  const config = await readContainerRestartConfig();
  await recordAudit({
    verb: 'container:view',
    entity: 'container_config',
    afterValues: { containerIds: Object.keys(config) },
    result: 'success',
  });
  return config;
}

export async function updateContainerConfig(containerId: string, config: {
  autoRestart?: boolean;
  maxRestarts?: number;
  currentRestarts?: number;
  discordNotifications?: boolean;
}) {
  await ensurePermission('container:update');
  try {
    const currentConfig = await getContainerConfig();

    const beforeEntry = currentConfig[containerId] ? { ...currentConfig[containerId] } : null;

    const afterEntry = {
      autoRestart: config.autoRestart ?? currentConfig[containerId]?.autoRestart ?? false,
      maxRestarts: config.maxRestarts ?? currentConfig[containerId]?.maxRestarts ?? 5,
      currentRestarts: config.currentRestarts ?? currentConfig[containerId]?.currentRestarts ?? 0,
      lastRestartTime: currentConfig[containerId]?.lastRestartTime,
      discordNotifications: config.discordNotifications ?? currentConfig[containerId]?.discordNotifications ?? true,
    };
    currentConfig[containerId] = afterEntry;
    await writeFile(containerRestartConfigPath(), JSON.stringify(currentConfig, null, 2));

    if (config.autoRestart !== undefined) {
      await updateDockerRestartPolicy(containerId, currentConfig[containerId].autoRestart, currentConfig[containerId].maxRestarts);
    }

    await recordAudit({
      verb: 'container:update',
      entity: 'container_config',
      entityId: String(containerId),
      beforeValues: beforeEntry,
      afterValues: { containerId, config: afterEntry },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    console.error('Failed to update container config:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function resetRestartCount(containerId: string) {
  await ensurePermission('container:update');
  try {
    const currentConfig = await getContainerConfig();

    const hadEntry = Boolean(currentConfig[containerId]);
    const beforeRestarts = currentConfig[containerId]?.currentRestarts ?? null;
    if (currentConfig[containerId]) {
      currentConfig[containerId].currentRestarts = 0;
      await writeFile(containerRestartConfigPath(), JSON.stringify(currentConfig, null, 2));
    }

    if (hadEntry) {
      await recordAudit({
        verb: 'container:update',
        entity: 'container_config',
        entityId: String(containerId),
        beforeValues: { currentRestarts: beforeRestarts },
        afterValues: { currentRestarts: 0, action: 'resetRestartCount' },
        result: 'success',
      });
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to reset restart count:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function updateDockerRestartPolicy(containerId: string, autoRestart: boolean, maxRestarts: number) {
  if (!CONTAINER_ID_RE.test(containerId)) {
    throw new Error('Invalid container id or action');
  }

  let policy: string;
  if (autoRestart) {
    const validatedRestarts = Number.isInteger(maxRestarts) && maxRestarts >= 0 && maxRestarts <= 20 ? maxRestarts : 5;
    policy = `on-failure:${validatedRestarts}`;
  } else {
    policy = 'no';
  }

  if (!RESTART_POLICY_RE.test(policy)) {
    throw new Error('Invalid restart policy');
  }

  try {
    await execPromise(`docker update --restart=${policy} ${containerId}`);
  } catch (error) {
    console.error('Failed to update Docker restart policy:', error);
    throw error;
  }
}

export async function syncContainerConfigWithDocker(containerId: string) {
  await ensurePermission('container:update');
  if (!CONTAINER_ID_RE.test(containerId)) {
    return { success: false, error: 'Invalid container id or action' };
  }
  try {
    const { stdout } = await execPromise(`docker inspect ${containerId} --format='{{.HostConfig.RestartPolicy.Name}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}'`);
    const [policyName, maxRetries] = stdout.trim().split(':');

    const config = await getContainerConfig();
    const currentConfig = config[containerId] || {};

    const dockerAutoRestart = policyName === 'on-failure' || policyName === 'always' || policyName === 'unless-stopped';
    const dockerMaxRestarts = policyName === 'on-failure' ? parseInt(maxRetries) || 5 : 999;

    await updateContainerConfig(containerId, {
      autoRestart: dockerAutoRestart,
      maxRestarts: dockerMaxRestarts,
      currentRestarts: currentConfig.currentRestarts || 0,
      discordNotifications: currentConfig.discordNotifications ?? true,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to sync container config:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function initializeContainerConfig(containerId: string) {
  await ensurePermission('container:update');
  const config = await getContainerConfig();

  if (!config[containerId]) {
    await syncContainerConfigWithDocker(containerId);
  }
}
