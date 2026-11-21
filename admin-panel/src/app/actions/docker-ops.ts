'use server';

import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { readDeploymentModeSetting } from '@/lib/deployment-mode-file';
import { buildRebuildCommand, type RebuildStack } from '@/lib/make-command';
import { recordAudit } from '@/lib/audit';

const execPromise = util.promisify(exec);

/** What a maintenance action reports back to the settings screen. */
export type MaintenanceActionResult =
  | { success: true; message: string; output: string }
  | { success: false; error: string; output?: string };

export async function pullLatestImages(): Promise<MaintenanceActionResult> {
  await ensurePermission('container:control');
  try {
    const rootDir = getRepoRoot();
    const { stdout, stderr } = await execPromise('make pull', { cwd: rootDir, timeout: 300000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr, output: stdout };
    }

    await recordAudit({
      verb: 'container:control',
      entity: 'container',
      afterValues: { action: 'pull', target: 'images' },
      result: 'success',
    });
    return { success: true, message: 'Images pulled successfully', output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Rebuilds a stack through the Makefile's own stack targets, in the mode config.toml declares.
 *
 * Why the mode is read here rather than left to the target: `make <stack>` takes DEPLOYMENT_TYPE from
 * .env, which only `./cms config sync` writes, while this panel reads config.toml directly (see
 * lib/deployment-mode-file.ts). The builder turns the mode into the target's own override variable, so
 * the rebuild does what the deployment is configured to do — pull and recreate without building, or
 * build from source — instead of always pulling the registry image.
 */
export async function rebuildImages(stack: RebuildStack): Promise<MaintenanceActionResult> {
  await ensurePermission('container:control');
  try {
    const rootDir = getRepoRoot();
    const mode = (await readDeploymentModeSetting(rootDir)).mode;
    const cmd = buildRebuildCommand(stack, mode);

    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir, timeout: 600000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr, output: stdout };
    }

    await recordAudit({
      verb: 'container:control',
      entity: 'container',
      beforeValues: { previousImages: stack },
      afterValues: { action: 'rebuild', stack, mode, command: cmd },
      result: 'success',
    });
    return { success: true, message: `${stack} stack rebuilt successfully`, output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
