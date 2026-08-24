'use server';

import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { ensurePermission, getFreshPermissions, hasPermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getRepoRoot } from '@/lib/repo-root';

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

// ---------------------------------------------------------------------------
// Live worker telemetry (real sources: docker inspect/logs, TCP probe,
// open-evaluation counts). Replaces the never-populated `services` table.
// ---------------------------------------------------------------------------
export interface WorkerLiveDetail {
    host: string;
    port: number;
    shard: number | null;
    state: 'running' | 'exited' | 'absent' | string;
    health: string;
    restarts: number;
    uptime: string;
    contest: number | null;
    activity: 'working' | 'connecting' | 'erroring' | 'idle' | 'unknown';
    lastLog: string;
    reachable: boolean;
    /** Open (outcome-less) evaluations routed to this shard */
    tasks: number;
    /** Backlog heuristic: tasks >= LAGGING_TASK_THRESHOLD */
    lagging: boolean;
}

const LAGGING_TASK_THRESHOLD = 5;

export async function getWorkersLiveStatus(): Promise<{
    forbidden: boolean;
    canManage: boolean;
    workers: WorkerLiveDetail[];
}> {
    const session = await getSession();
    if (!session) return { forbidden: true, canManage: false, workers: [] };
    const fresh = await getFreshPermissions(session.userId);
    if (!fresh) return { forbidden: true, canManage: false, workers: [] };

    // Viewing worker health is an operator concern (tasks); management stays superadmin.
    const canView = hasPermission(fresh, 'tasks');
    const canManage = hasPermission(fresh, 'all');
    if (!canView) return { forbidden: true, canManage, workers: [] };

    let details: Array<Record<string, unknown>> = [];
    try {
        const { stdout } = await execFileP('bash', [path.join(getRepoRoot(), 'scripts', '__worker_status_json.sh')], {
            cwd: getRepoRoot(),
            timeout: 15_000,
        });
        details = JSON.parse(stdout);
    } catch {
        details = []; // emitter failure still renders rows as unknown/offline
    }

    // Open evaluations grouped by shard — the real working/backlog signal.
    let tasksByShard = new Map<number, number>();
    try {
        const groups = await prisma.evaluations.groupBy({
            by: ['evaluation_shard'],
            where: { outcome: null },
            _count: { _all: true },
        });
        tasksByShard = new Map(
            groups
                .filter((g) => g.evaluation_shard !== null)
                .map((g) => [g.evaluation_shard as number, g._count._all])
        );
    } catch { /* table may not exist pre-init */ }

    const num = <T,>(v: unknown, fallback: T): T =>
        typeof v === typeof fallback ? (v as T) : fallback;

    const workers: WorkerLiveDetail[] = details.map((d, index) => {
        const host = String(d.host ?? '');
        const port = Number(d.port ?? 0);
        const shard = typeof d.shard === 'number' ? d.shard : index;
        const tasks = tasksByShard.get(shard) ?? 0;
        return {
            host,
            port,
            shard,
            state: num(d.state, 'unknown'),
            health: num(d.health, 'none'),
            restarts: num(d.restarts, 0),
            uptime: num(d.uptime, ''),
            contest: num<number | null>(d.contest, null),
            activity: num(d.activity, 'unknown'),
            lastLog: num(d.lastLog, ''),
            reachable: Boolean(d.reachable),
            tasks,
            lagging: tasks >= LAGGING_TASK_THRESHOLD,
        };
    });

    return { forbidden: false, canManage, workers };
}
