'use server';

import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';
import { buildComposeCommand } from '@/lib/compose-command';
import { CONTAINER_ID_RE } from '@/lib/container-probes';

const execPromise = util.promisify(exec);

const CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause'] as const;

// Why re-exported: the container list is now read by the streaming route, and the components that
// render it keep importing their shape from where they always did.
export type { ContainerInfo } from '@/lib/container-probes';

export async function controlContainer(id: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause') {
  await ensurePermission('container:control');
  if (!(CONTAINER_ACTIONS as readonly string[]).includes(action) || !CONTAINER_ID_RE.test(id)) {
    return { success: false, error: 'Invalid container id or action' };
  }
  try {
    const { stdout, stderr } = await execPromise(`docker ${action} ${id}`);
    if (stderr && !stdout) throw new Error(stderr);
    await recordAudit({
      verb: 'container:control',
      entity: 'container',
      entityId: String(id),
      afterValues: { action, containerId: id },
      result: 'success',
    });
    return { success: true };
  } catch (error) {
    console.error(`Failed to ${action} container ${id}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

export async function getContainerLogs(id: string, tail: number = 100) {
  await ensurePermission('container:read');
  const coercedTail = Number.isInteger(Number(tail)) && Number(tail) >= 1 && Number(tail) <= 1000 ? Number(tail) : 100;
  if (!CONTAINER_ID_RE.test(id)) {
    return { success: false, error: 'Invalid container id or action' };
  }
  try {
    const { stdout, stderr } = await execPromise(`docker logs --tail ${coercedTail} ${id}`);
    return { success: true, logs: stdout || stderr };
  } catch (error) {
    console.error(`Failed to get logs for container ${id}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

const CONTEST_WEB_SERVER_CONTAINER = 'cms-contest-web-server';

export async function getContainerContestId(): Promise<{ success: true; contestId: number | null } | { success: false; error: string }> {
  await ensurePermission('container:read');
  try {
    const { stdout } = await execPromise(`docker inspect ${CONTEST_WEB_SERVER_CONTAINER} --format '{{range .Config.Env}}{{println .}}{{end}}'`);
    const match = stdout.match(/^CONTEST_ID=(\d+)$/m);
    return { success: true, contestId: match ? parseInt(match[1], 10) : null };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function runCompose(action: 'up' | 'down' | 'restart' | 'build', serviceType?: 'core' | 'admin' | 'contest' | 'worker'): Promise<{ success: true; output: string } | { success: false; error: string }> {
  await ensurePermission('container:control');
  try {
    const repoRoot = getRepoRoot();
    const cmd = buildComposeCommand(action, serviceType);

    const { stdout, stderr } = await execPromise(cmd, { cwd: repoRoot });
    await recordAudit({
      verb: 'container:control',
      entity: 'container',
      afterValues: { action, serviceType: serviceType ?? 'all', command: cmd },
      result: 'success',
    });
    return { success: true, output: stdout || stderr };
  } catch (error) {
    console.error('Compose command failed:', error);
    return { success: false, error: (error as Error).message };
  }
}
