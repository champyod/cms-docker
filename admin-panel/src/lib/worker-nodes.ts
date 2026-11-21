/**
 * The single worker-node model shared by every panel surface.
 *
 * Why one model: worker rows used to be shaped twice — once from the fleet
 * emitter (`worker-stats.ts`) and once by hand in the deployments action — so
 * the same shard could read online in one screen and disconnected in another.
 * Everything now derives from the emitter rows through `mapEmitterRowsToNodes`.
 */

export type WorkerConnectionState = 'connected' | 'busy' | 'disconnected' | 'unknown';

export interface WorkerConfig {
  host: string;
  port: number;
}

export interface WorkerNodeView {
  id: string;
  host: string;
  port: number;
  shard: number | null;
  endpoint: string;
  connection: WorkerConnectionState;
  state: string;
  health: string;
  activity: string;
  reachable: boolean;
  tasks: number;
  load: number;
  lagging: boolean;
  contest: number | null;
  uptime: string;
  restarts: number;
  lastLog: string;
}

/**
 * The key namespace of a row the live fleet names but the configuration does not carry.
 *
 * Why a namespace of its own: the configured rows are addressed by their list index, so
 * a live-only row keyed on anything else cannot be read back as one of them.
 */
const LIVE_ROW_KEY_PREFIX = 'live:';

/**
 * A list row: a configured endpoint that may or may not have a live reading yet, or a row only
 * the live stream names, which `configured: false` marks as one the configuration does not carry.
 */
export interface WorkerNodeListRow {
  key: string;
  host: string;
  port: number;
  live: WorkerNodeView | null;
  /**
   * Whether the configuration carries this row. A worker that runs without an entry in the
   * configuration has nothing for Remove or Edit to write, so those controls stay off it.
   */
  configured: boolean;
}

/** One row of `scripts/__worker_status_json.sh`, loosely typed because it is parsed JSON. */
export interface EmitterWorkerRow {
  shard?: unknown;
  host?: unknown;
  port?: unknown;
  name?: unknown;
  endpoint?: unknown;
  state?: unknown;
  health?: unknown;
  activity?: unknown;
  reachable?: unknown;
  restarts?: unknown;
  uptime?: unknown;
  contest?: unknown;
  lastLog?: unknown;
}

export const LAGGING_TASK_THRESHOLD = 5;

/** Tasks that fill the load bar; kept with the threshold so both share one scale. */
const TASKS_PER_FULL_LOAD = 10;

export function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function workerLoad(tasks: number): number {
  return tasks > 0 ? Math.min(100, (tasks / TASKS_PER_FULL_LOAD) * 100) : 0;
}

/**
 * The endpoint a row addresses.
 *
 * Why both shapes are accepted: the emitter writes `endpoint` ("host:port"),
 * while an in-process caller may already have host and port split apart.
 */
export function parseWorkerEndpoint(row: EmitterWorkerRow): { host: string; port: number } {
  const hostField = typeof row.host === 'string' ? row.host : '';
  if (hostField) {
    return { host: hostField, port: typeof row.port === 'number' ? row.port : 0 };
  }

  const endpoint = typeof row.endpoint === 'string' ? row.endpoint : '';
  const lastColon = endpoint.lastIndexOf(':');
  if (lastColon === -1) return { host: endpoint, port: 0 };
  return { host: endpoint.slice(0, lastColon), port: Number(endpoint.slice(lastColon + 1)) || 0 };
}

/**
 * Liveness for one row, correct for local and remote alike.
 *
 * Why reachability joins the docker state: a remote shard has no container on
 * this host, so `absent` there means "lives elsewhere" and the TCP probe is the
 * only honest signal. A local shard that should exist and does not stays down.
 */
export function connectionStateOf(row: EmitterWorkerRow, tasks: number): WorkerConnectionState {
  const state = textOf(row.state, 'unknown');
  const reachable = row.reachable === true;
  const live = state === 'running' || ((state === 'absent' || state === 'remote') && reachable);

  if (!live) return state === 'unknown' ? 'unknown' : 'disconnected';
  if (tasks > 0 || textOf(row.activity, '') === 'working') return 'busy';
  return 'connected';
}

export function mapEmitterRowsToNodes(
  rows: EmitterWorkerRow[],
  shardCounts: Record<number, number>
): WorkerNodeView[] {
  return rows.map((row, index) => {
    const shard = typeof row.shard === 'number' ? row.shard : index;
    const tasks = shardCounts[shard] ?? 0;
    const { host, port } = parseWorkerEndpoint(row);

    return {
      id: `worker-${shard}`,
      host,
      port,
      shard: typeof row.shard === 'number' ? row.shard : null,
      endpoint: textOf(row.endpoint, `${host}:${port}`),
      connection: connectionStateOf(row, tasks),
      state: textOf(row.state, 'unknown'),
      health: textOf(row.health, 'none'),
      activity: textOf(row.activity, 'unknown'),
      reachable: row.reachable === true,
      tasks,
      load: workerLoad(tasks),
      lagging: tasks >= LAGGING_TASK_THRESHOLD,
      contest: typeof row.contest === 'number' ? row.contest : null,
      uptime: textOf(row.uptime, ''),
      restarts: typeof row.restarts === 'number' ? row.restarts : 0,
      lastLog: textOf(row.lastLog, ''),
    };
  });
}

/** One row per live reading, in the live-only key namespace. */
export function rowFromNode(view: WorkerNodeView): WorkerNodeListRow {
  return {
    key: `${LIVE_ROW_KEY_PREFIX}${view.host}:${view.port}`,
    host: view.host,
    port: view.port,
    live: view,
    configured: false,
  };
}

/**
 * One row per distinct endpoint, however many readings named it.
 *
 * Why de-duplicated here rather than at each caller: the stream can report one endpoint twice,
 * and two rows carrying the same key render as duplicate React keys on every surface that draws
 * them, which is the join only the deployments panel happened to do for itself.
 */
export function rowsFromNodes(views: WorkerNodeView[]): WorkerNodeListRow[] {
  const seen = new Set<string>();
  return views
    .filter((view) => {
      const endpoint = `${view.host}:${view.port}`;
      if (seen.has(endpoint)) return false;
      seen.add(endpoint);
      return true;
    })
    .map(rowFromNode);
}
