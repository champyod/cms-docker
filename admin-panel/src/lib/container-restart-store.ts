import { readFile } from 'fs/promises';
import path from 'path';
import { getRepoRoot } from '@/lib/repo-root';

export interface ContainerRestartConfigEntry {
  autoRestart: boolean;
  maxRestarts: number;
  currentRestarts: number;
  lastRestartTime?: number;
  discordNotifications: boolean;
}

export interface ContainerRestartConfig {
  [containerId: string]: ContainerRestartConfigEntry;
}

export function containerRestartConfigPath(): string {
  return path.join(getRepoRoot(), 'config', 'container-restart.json');
}

/**
 * Reads the restart configuration file.
 *
 * Why it is separate from the action that exposes it: the containers stream re-sends this with every
 * snapshot, and a stream frame cannot afford a permission check per read. An unreadable or malformed
 * file is reported as "no configuration", which is the same thing the panel showed before.
 */
export async function readContainerRestartConfig(): Promise<ContainerRestartConfig> {
  try {
    const data = await readFile(containerRestartConfigPath(), 'utf-8');
    return JSON.parse(data) as ContainerRestartConfig;
  } catch {
    return {};
  }
}
