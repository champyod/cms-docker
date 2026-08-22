'use server';

import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensurePermission } from '@/lib/permissions';

const execFileP = promisify(execFile);

const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

export async function getWorkerStatus(host: string, port?: number): Promise<{
  status: string;
  containerRunning: boolean;
  host: string;
  port?: number;
}> {
  await ensurePermission('all');
  if (!HOST_RE.test(host)) {
    return { status: 'unknown', containerRunning: false, host, port };
  }

  let containerRunning = false;
  try {
    const { stdout } = await execFileP('docker', ['ps', '--filter', `name=${host}`, '--format', '{{.Names}}']);
    containerRunning = stdout.trim().split('\n').some((n) => n.trim() === host);
  } catch {
    containerRunning = false;
  }

  let status = 'disconnected';
  if (containerRunning) {
    try {
      const { stdout } = await execFileP('docker', ['exec', host, 'pgrep', '-f', 'cmsWorker']);
      status = stdout.trim() ? 'idle' : 'disconnected';
    } catch {
      status = 'disconnected';
    }
  }

  return { status, containerRunning, host, port };
}
