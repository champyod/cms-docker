'use server';

import { exec } from 'child_process';
import util from 'util';
import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';

const execPromise = util.promisify(exec);

export async function pullLatestImages() {
  await ensurePermission('all');
  try {
    const rootDir = getRepoRoot();
    const { stdout, stderr } = await execPromise('make pull', { cwd: rootDir, timeout: 300000 });

    if (stderr && stderr.includes('error')) {
      return { success: false, error: stderr, output: stdout };
    }

    return { success: true, message: 'Images pulled successfully', output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function rebuildImages(stack: 'core' | 'admin' | 'worker' | 'all') {
  await ensurePermission('all');
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

    return { success: true, message: `${stack} stack rebuilt successfully`, output: stdout };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function getCoreServicesStatus() {
  await ensurePermission('all');
  try {
    const services = [
      'cms-database',
      'cms-log-service',
      'cms-resource-service',
      'cms-scoring-service',
      'cms-evaluation-service',
      'cms-proxy-service',
      'cms-checker-service'
    ];

    const statuses = await Promise.all(
      services.map(async (service) => {
        try {
          const { stdout } = await execPromise(`docker inspect ${service} --format='{{.State.Status}}:{{.State.Health.Status}}'`);
          const [state, health] = stdout.trim().split(':');
          return {
            name: service,
            status: state === 'running' ? (health === 'healthy' || health === '' ? 'healthy' : health) : state
          };
        } catch {
          return { name: service, status: 'stopped' };
        }
      })
    );

    return { success: true, services: statuses };
  } catch (error) {
    return { success: false, services: [], error: (error as Error).message };
  }
}

export async function getNetworkTrafficLogs(limit: number = 50) {
  await ensurePermission('all');
  try {
    const coercedLimit = Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 500 ? Number(limit) : 50;
    // Read network traffic from docker stats
    const { stdout } = await execPromise(
      `docker stats --no-stream --format "{{.Name}}\t{{.NetIO}}" | head -n ${coercedLimit}`
    );

    const logs = stdout.trim().split('\n').map((line, index) => {
      const [name, netIO] = line.split('\t');
      const [rx, tx] = netIO.split(' / ');
      return {
        id: index,
        timestamp: new Date().toISOString(),
        container: name,
        rx: rx.trim(),
        tx: tx.trim()
      };
    });

    return { success: true, logs };
  } catch (error) {
    return { success: false, logs: [], error: (error as Error).message };
  }
}
