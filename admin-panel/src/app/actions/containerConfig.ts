'use server';

import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const RESTART_POLICY_RE = /^(?:no|always|unless-stopped|on-failure:(?:[0-9]|1[0-9]|20))$/;

const CONFIG_PATH = () => path.join(getRepoRoot(), 'config', 'container-restart.json');

export interface ContainerRestartConfig {
  [containerId: string]: {
    autoRestart: boolean;
    maxRestarts: number;
    currentRestarts: number;
    lastRestartTime?: number;
    discordNotifications: boolean;
  };
}

export async function getContainerConfig(): Promise<ContainerRestartConfig> {
  await ensurePermission('all');
  try {
    const data = await readFile(CONFIG_PATH(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function updateContainerConfig(containerId: string, config: {
  autoRestart?: boolean;
  maxRestarts?: number;
  currentRestarts?: number;
  discordNotifications?: boolean;
}) {
  await ensurePermission('all');
  try {
    const currentConfig = await getContainerConfig();

    currentConfig[containerId] = {
      autoRestart: config.autoRestart ?? currentConfig[containerId]?.autoRestart ?? false,
      maxRestarts: config.maxRestarts ?? currentConfig[containerId]?.maxRestarts ?? 5,
      currentRestarts: config.currentRestarts ?? currentConfig[containerId]?.currentRestarts ?? 0,
      lastRestartTime: currentConfig[containerId]?.lastRestartTime,
      discordNotifications: config.discordNotifications ?? currentConfig[containerId]?.discordNotifications ?? true,
    };

    await writeFile(CONFIG_PATH(), JSON.stringify(currentConfig, null, 2));

    // Update Docker container restart policy
    if (config.autoRestart !== undefined) {
      await updateDockerRestartPolicy(containerId, currentConfig[containerId].autoRestart, currentConfig[containerId].maxRestarts);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to update container config:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function resetRestartCount(containerId: string) {
  await ensurePermission('all');
  try {
    const currentConfig = await getContainerConfig();

    if (currentConfig[containerId]) {
      currentConfig[containerId].currentRestarts = 0;
      await writeFile(CONFIG_PATH(), JSON.stringify(currentConfig, null, 2));
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

export async function getContainerRestartCount(containerId: string): Promise<number> {
  await ensurePermission('all');
  if (!CONTAINER_ID_RE.test(containerId)) {
    return 0;
  }
  try {
    const { stdout } = await execPromise(`docker inspect ${containerId} --format='{{.RestartCount}}'`);
    return parseInt(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export async function syncContainerConfigWithDocker(containerId: string) {
  await ensurePermission('all');
  if (!CONTAINER_ID_RE.test(containerId)) {
    return { success: false, error: 'Invalid container id or action' };
  }
  try {
    // Get Docker restart policy
    const { stdout } = await execPromise(`docker inspect ${containerId} --format='{{.HostConfig.RestartPolicy.Name}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}'`);
    const [policyName, maxRetries] = stdout.trim().split(':');

    const config = await getContainerConfig();
    const currentConfig = config[containerId] || {};

    // Sync with Docker settings
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
  await ensurePermission('all');
  const config = await getContainerConfig();

  if (!config[containerId]) {
    // Sync with Docker first
    await syncContainerConfigWithDocker(containerId);
  }
}
