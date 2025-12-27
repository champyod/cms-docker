'use server';

import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

const getRepoRoot = () => process.env.IS_DOCKER === 'true' ? '/repo-root' : path.resolve(process.cwd(), '..');

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
}

export async function getContainers() {
  try {
    const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
    const lines = stdout.trim().split('\n');
    if (!stdout.trim()) return [];
    
    return lines.map(line => {
      const parsed = JSON.parse(line);
      return {
        id: parsed.ID,
        name: parsed.Names,
        image: parsed.Image,
        status: parsed.Status,
        state: parsed.State,
        created: parsed.CreatedAt
      } as ContainerInfo;
    });
  } catch (error) {
    console.error('Failed to get containers:', error);
    return [];
  }
}

export async function controlContainer(id: string, action: 'start' | 'stop' | 'restart') {
  try {
    const { stdout, stderr } = await execPromise(`docker ${action} ${id}`);
    if (stderr && !stdout) throw new Error(stderr);
    return { success: true };
  } catch (error) {
    console.error(`Failed to ${action} container ${id}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

export async function runCompose(action: 'up' | 'down' | 'restart' | 'build', serviceType?: 'core' | 'admin' | 'contest' | 'worker') {
  try {
    const repoRoot = getRepoRoot();
    let fileArgs = '';
    
    if (serviceType === 'core') fileArgs = '-f docker-compose.core.yml';
    else if (serviceType === 'admin') fileArgs = '-f docker-compose.admin.yml';
    else if (serviceType === 'contest') fileArgs = '-f docker-compose.contest.yml';
    else if (serviceType === 'worker') fileArgs = '-f docker-compose.worker.yml';
    else {
      fileArgs = '-f docker-compose.core.yml -f docker-compose.admin.yml -f docker-compose.contest.yml -f docker-compose.worker.yml';
    }

    let cmd = `docker compose ${fileArgs} ${action}`;
    if (action === 'up') cmd += ' -d';
    if (action === 'build') cmd += ' --no-cache';

    const { stdout, stderr } = await execPromise(cmd, { cwd: repoRoot });
    return { success: true, output: stdout || stderr };
  } catch (error) {
    console.error('Compose command failed:', error);
    return { success: false, error: (error as Error).message };
  }
}
