'use server';

import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';
import { recordAudit } from '@/lib/audit';

const execPromise = util.promisify(exec);

export async function pullLatestImages() {
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

export async function rebuildImages(stack: 'core' | 'admin' | 'worker' | 'all') {
  await ensurePermission('container:control');
  try {
    const rootDir = getRepoRoot();
    let cmd = '';

    switch (stack) {
      case 'core':
        cmd = 'make core-img';
        break;
      case 'admin':
        cmd = 'make admin-img';
        break;
      case 'worker':
        cmd = 'make worker-img';
        break;
      case 'all':
        cmd = 'make core-img && make admin-img && make worker-img';
        break;
    }

    const { stdout, stderr } = await execPromise(cmd, { cwd: rootDir, timeout: 600000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr, output: stdout };
    }

    await recordAudit({
      verb: 'container:control',
      entity: 'container',
      beforeValues: { previousImages: stack },
      afterValues: { action: 'rebuild', stack },
      result: 'success',
    });
    return { success: true, message: `${stack} stack rebuilt successfully`, output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
