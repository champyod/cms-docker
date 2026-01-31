'use server';

import { ensurePermission } from '@/lib/permissions';
import { readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

const CONFIG_PATH = () => path.join(getRepoRoot(), 'config', 'container-restart.json');

export interface ContainerRestartConfig {
  [containerId: string]: {
    autoRestart: boolean;
    maxRestarts: number;
    currentRestarts: number;
    lastRestartTime?: number;
  };
}

export async function getContainerConfig(): Promise<ContainerRestartConfig> {
  await ensurePermission('all');
  try {
    const data = await readFile(CONFIG_PATH(), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

export async function updateContainerConfig(containerId: string, config: {
  autoRestart?: boolean;
  maxRestarts?: number;
  currentRestarts?: number;
}) {
  await ensurePermission('all');
  try {
    const currentConfig = await getContainerConfig();

    currentConfig[containerId] = {
      autoRestart: config.autoRestart ?? currentConfig[containerId]?.autoRestart ?? false,
      maxRestarts: config.maxRestarts ?? currentConfig[containerId]?.maxRestarts ?? 5,
      currentRestarts: config.currentRestarts ?? currentConfig[containerId]?.currentRestarts ?? 0,
      lastRestartTime: currentConfig[containerId]?.lastRestartTime,
    };

    await writeFile(CONFIG_PATH(), JSON.stringify(currentConfig, null, 2));

    // Update Docker container restart policy
    await updateDockerRestartPolicy(containerId, currentConfig[containerId].autoRestart, currentConfig[containerId].maxRestarts);

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
  try {
    let policy = 'no';

    if (autoRestart) {
      policy = `on-failure:${maxRestarts}`;
    }

    await execPromise(`docker update --restart=${policy} ${containerId}`);
  } catch (error) {
    console.error('Failed to update Docker restart policy:', error);
    throw error;
  }
}

export async function getContainerRestartCount(containerId: string): Promise<number> {
  await ensurePermission('all');
  try {
    const { stdout } = await execPromise(`docker inspect ${containerId} --format='{{.RestartCount}}'`);
    return parseInt(stdout.trim()) || 0;
  } catch (error) {
    return 0;
  }
}

export async function initializeContainerConfig(containerId: string, containerName: string) {
  await ensurePermission('all');
  const config = await getContainerConfig();

  if (!config[containerId]) {
    await updateContainerConfig(containerId, {
      autoRestart: false,
      maxRestarts: 5,
      currentRestarts: 0,
    });
  }
}
