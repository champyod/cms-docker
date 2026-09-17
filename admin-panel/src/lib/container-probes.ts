import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

/**
 * Container and service probes, shared by the server actions and the streaming routes.
 *
 * Why they live here: a stream cannot run a permission check per frame (that would be the per-second
 * query this change exists to remove), so the checks stay in the callers and these functions only
 * read. Every probe absorbs its own failure and reports it in the return value, because a resource
 * that is briefly unreadable must not end the stream that carries the other resources.
 */
export const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  isCmsContainer: boolean;
}

export interface CoreServiceStatus {
  name: string;
  status: string;
}

export type CoreServicesResult =
  | { success: true; services: CoreServiceStatus[] }
  | { success: false; services: CoreServiceStatus[]; error: string };

export interface TrafficLog {
  id: number;
  timestamp: string;
  container: string;
  rx: string;
  tx: string;
}

export type TrafficLogsResult =
  | { success: true; logs: TrafficLog[] }
  | { success: false; logs: TrafficLog[]; error: string };

const CORE_SERVICE_NAMES: readonly string[] = [
  'cms-database',
  'cms-log-service',
  'cms-resource-service',
  'cms-scoring-service',
  'cms-evaluation-service',
  'cms-proxy-service',
  'cms-checker-service',
];

export async function collectContainers(): Promise<ContainerInfo[]> {
  try {
    const { stdout } = await execPromise('docker ps -a --format "{{json .}}"');
    if (!stdout.trim()) return [];

    return stdout.trim().split('\n').map((line) => {
      const parsed = JSON.parse(line) as { ID: string; Names: string; Image: string; Status: string; State: string; CreatedAt: string };
      const name = parsed.Names;
      return {
        id: parsed.ID,
        name,
        image: parsed.Image,
        status: parsed.Status,
        state: parsed.State,
        created: parsed.CreatedAt,
        isCmsContainer: name.startsWith('cms-') || name.includes('cms'),
      };
    });
  } catch (error) {
    console.error('Failed to get containers:', error);
    return [];
  }
}

export async function collectContainerRestartCount(containerId: string): Promise<number> {
  if (!CONTAINER_ID_RE.test(containerId)) return 0;
  try {
    const { stdout } = await execPromise(`docker inspect ${containerId} --format='{{.RestartCount}}'`);
    return parseInt(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export async function collectCoreServicesStatus(): Promise<CoreServicesResult> {
  try {
    const services = await Promise.all(
      CORE_SERVICE_NAMES.map(async (service): Promise<CoreServiceStatus> => {
        try {
          const { stdout } = await execPromise(`docker inspect ${service} --format='{{.State.Status}}:{{.State.Health.Status}}'`);
          const [state, health] = stdout.trim().split(':');
          return {
            name: service,
            status: state === 'running' ? (health === 'healthy' || health === '' ? 'healthy' : health) : state,
          };
        } catch {
          return { name: service, status: 'stopped' };
        }
      })
    );

    return { success: true, services };
  } catch (error) {
    return { success: false, services: [], error: (error as Error).message };
  }
}

export async function collectNetworkTrafficLogs(limit: number = 50): Promise<TrafficLogsResult> {
  const coercedLimit = Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 500 ? Number(limit) : 50;
  try {
    const { stdout } = await execPromise(
      `docker stats --no-stream --format "{{.Name}}\t{{.NetIO}}" | head -n ${coercedLimit}`
    );

    const logs = stdout.trim().split('\n').filter(Boolean).map((line, index) => {
      const [name, netIO] = line.split('\t');
      const [rx, tx] = (netIO ?? '').split(' / ');
      return {
        id: index,
        timestamp: new Date().toISOString(),
        container: name,
        rx: (rx ?? '').trim(),
        tx: (tx ?? '').trim(),
      };
    });

    return { success: true, logs };
  } catch (error) {
    return { success: false, logs: [], error: (error as Error).message };
  }
}
