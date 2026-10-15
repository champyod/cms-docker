import path from 'path';
import { exec, execFile } from 'child_process';
import util from 'util';
import { prisma } from '@/lib/prisma';
import { readConfigFile } from '@/lib/config-file';
import { getRepoRoot } from './repo-root';
import {
  LAGGING_TASK_THRESHOLD,
  mapEmitterRowsToNodes,
  workerLoad,
  type EmitterWorkerRow,
  type WorkerNodeView,
} from './worker-nodes';
import { CONFIG_TOML_FILE } from '@/lib/config-toml';
import { readTomlValue } from '@/lib/discord-webhook';

const execPromise = util.promisify(exec);
const execFilePromise = util.promisify(execFile);

// Why 12s: the emitter probes shards sequentially (2s each worst case), so a
// tick must never stack overlapping runs on the 5s summary interval.
const EMITTER_TIMEOUT_MS = 12000;
const EMITTER_SCRIPT = ['scripts', '__worker_status_json.sh'];

type ConfiguredWorker = { shard: number; host: string; port: number };

const WORKER_TOML_SECTION = 'worker';
const WORKER_KEY_RE = /^WORKER_(\d+)$/;
const WORKER_ENDPOINT_RE = /^([^:]+):(\d+)$/;

/** The shard a fleet key names, or null when the key is not a fleet row. */
function workerShardOf(key: string): number | null {
  const match = key.match(WORKER_KEY_RE);
  return match ? parseInt(match[1], 10) : null;
}

/** One `host:port` endpoint with any wrapping quotes dropped; null when it is not one. */
function parseWorkerEndpoint(raw: string): { host: string; port: number } | null {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  const match = value.match(WORKER_ENDPOINT_RE);
  if (!match) return null;
  return { host: match[1].trim(), port: parseInt(match[2], 10) };
}

/** The fleet the process was handed — what compose delivers to the panel container. */
function environmentWorkers(): Map<number, ConfiguredWorker> {
  const workers = new Map<number, ConfiguredWorker>();
  for (const [key, raw] of Object.entries(process.env)) {
    if (raw === undefined) continue;
    const shard = workerShardOf(key);
    if (shard === null) continue;
    const endpoint = parseWorkerEndpoint(raw);
    if (endpoint) workers.set(shard, { shard, ...endpoint });
  }
  return workers;
}

/**
 * The fleet config.toml [worker] declares — the source the sync renders .env from.
 * Why readTomlValue: it is the panel's section-scoped reader, and it already decodes
 * the `WORKER_1 = "host:port"` form, quotes and a trailing comment included.
 */
function tomlWorkers(content: string): Map<number, ConfiguredWorker> {
  const workers = new Map<number, ConfiguredWorker>();
  for (const line of content.split('\n')) {
    const shard = workerShardOf(line.split('=')[0].trim());
    if (shard === null) continue;
    const raw = readTomlValue(content, WORKER_TOML_SECTION, `WORKER_${shard}`);
    const endpoint = parseWorkerEndpoint(raw);
    if (endpoint) workers.set(shard, { shard, ...endpoint });
  }
  return workers;
}

/** A file the fleet is read from, and the parser that understands its shape. */
const WORKER_CONFIG_SOURCES: ReadonlyArray<{
  file: string;
  parse: (content: string) => Map<number, ConfiguredWorker>;
}> = [
  { file: CONFIG_TOML_FILE, parse: tomlWorkers },
];

/** The fleet the configuration yields, and the sources that exist but could not be read. */
interface ConfiguredFleet {
  readonly workers: ConfiguredWorker[];
  readonly unreadable: string[];
}

/**
 * Every configured worker, each shard taken from the first source that carries it:
 * config.toml (the file the panel writes), then the process environment. What compose handed
 * the process overrides the config, and the generated .env is deliberately not a source: it is
 * a render of config.toml, so reading it here could show a fleet the next `./cms config sync`
 * replaces.
 *
 * WHY the read failures are kept: a source that exists but cannot be read is not an empty
 * source, and folding the two together renders a permission problem as a worker-less fleet.
 *
 * Why exported: the worker-config action reads the same fleet through here, so the list the
 * operator edits and the readings the panel shows can never come from two different parsers.
 */
export async function loadConfiguredWorkers(repoRoot: string): Promise<ConfiguredFleet> {
  const merged = new Map<number, ConfiguredWorker>();
  const unreadable: string[] = [];
  for (const source of WORKER_CONFIG_SOURCES) {
    const read = await readConfigFile(path.join(repoRoot, source.file));
    if (read.kind === 'unreadable') {
      unreadable.push(read.reason);
      continue;
    }
    if (read.kind === 'absent') continue;
    for (const [shard, worker] of source.parse(read.content)) merged.set(shard, worker);
  }
  for (const [shard, worker] of environmentWorkers()) merged.set(shard, worker);
  return { workers: [...merged.values()].sort((a, b) => a.shard - b.shard), unreadable };
}

/** WHY: an empty fleet beside an unreadable source is a read fault, not "no workers". */
function unreadableFault(fleet: ConfiguredFleet): string | null {
  return fleet.unreadable.length === 0
    ? null
    : `Worker configuration could not be read: ${fleet.unreadable.join(', ')}`;
}

/** WHY: a collector that threw is a named fault, never an empty fleet with nothing to explain it. */
function collectorFault(what: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `${what}: ${reason}`;
}

/** Every reason the reading could have come back empty, so the caller shows the cause it has. */
function fleetFaults(faults: readonly (string | null)[]): string | null {
  const named = faults.filter((fault): fault is string => fault !== null);
  return named.length === 0 ? null : named.join('; ');
}

/** The worker nodes and the fault that emptied them, if any. */
export interface WorkerFleet {
  readonly workers: WorkerNodeView[];
  readonly error: string | null;
}

async function loadEmitterRows(): Promise<EmitterWorkerRow[]> {
  const { stdout } = await execFilePromise(
    'bash',
    [path.join(getRepoRoot(), ...EMITTER_SCRIPT)],
    { cwd: getRepoRoot(), timeout: EMITTER_TIMEOUT_MS }
  );
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as EmitterWorkerRow[]) : [];
}

/** One emitter pass: the rows it reported, or the fault that stopped it reporting a fleet. */
interface EmitterRead {
  readonly rows: EmitterWorkerRow[] | null;
  readonly fault: string | null;
}

/**
 * Why empty counts as failed: an emitter that read nothing cannot claim the fleet is empty.
 *
 * Why the empty answer carries no fault while a thrown one does: an emitter that answered `[]` is
 * the documented trigger for the docker fallback, while an emitter that threw is a fault the fleet
 * read has to name — folding the two together is how a broken collector read as an empty fleet.
 */
async function loadEmitterRowsOrNull(): Promise<EmitterRead> {
  try {
    const rows = await loadEmitterRows();
    if (rows.length > 0) return { rows, fault: null };
    console.error('Emitter reported no workers, falling back to docker ps');
    return { rows: null, fault: null };
  } catch (emitterError) {
    console.error('Emitter failed, falling back to docker ps:', emitterError);
    return { rows: null, fault: collectorFault('the emitter failed', emitterError) };
  }
}

async function loadShardCounts(): Promise<Record<number, number>> {
  // Open evaluations per shard — the real busy/backlog signal.
  const groups = await prisma.evaluations.groupBy({
    by: ['evaluation_shard'],
    where: { outcome: null },
    _count: { _all: true },
  });
  const shardCounts: Record<number, number> = {};
  for (const group of groups) {
    if (group.evaluation_shard !== null) shardCounts[group.evaluation_shard] = group._count._all;
  }
  return shardCounts;
}

interface LocalNodeInput {
  id: string;
  host: string;
  port: number;
  shard: number | null;
  endpoint: string;
  running: boolean;
  state: string;
  shardCounts: Record<number, number>;
}

/** A node the local docker daemon can see; the emitter's fallback when it is unreachable. */
function localNodeView({ id, host, port, shard, endpoint, running, state, shardCounts }: LocalNodeInput): WorkerNodeView {
  const tasks = shard !== null ? (shardCounts[shard] ?? 0) : 0;
  return {
    id,
    host,
    port,
    shard,
    endpoint,
    connection: running ? (tasks > 0 ? 'busy' : 'connected') : 'disconnected',
    state,
    health: 'none',
    activity: 'unknown',
    reachable: running,
    tasks,
    load: workerLoad(tasks),
    lagging: tasks >= LAGGING_TASK_THRESHOLD,
    contest: null,
    uptime: '',
    restarts: 0,
    lastLog: '',
  };
}

function parseContainerShard(name: string): number | null {
  const match = name.match(/cms-worker-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Why the docker read is bound to its own fault: a daemon the panel cannot reach is not a fleet with no workers. */
async function dockerWorkerLines(): Promise<string[]> {
  const { stdout } = await execPromise('docker ps -a --filter "name=cms-worker" --format "{{.Names}}\t{{.Status}}"');
  return stdout.trim() ? stdout.trim().split('\n') : [];
}

async function collectFromDocker(shardCounts: Record<number, number>, emitterFault: string | null): Promise<WorkerFleet> {
  const fleet = await loadConfiguredWorkers(getRepoRoot());
  const configuredFault = unreadableFault(fleet);
  let lines: string[];
  try {
    lines = await dockerWorkerLines();
  } catch (error) {
    return {
      workers: [],
      error: fleetFaults([configuredFault, emitterFault, collectorFault('the worker list could not be read from docker', error)]),
    };
  }

  if (fleet.workers.length > 0) {
    const configured = fleet.workers.map((worker) => localNodeView({
      id: `worker-${worker.shard}`,
      host: worker.host,
      port: worker.port,
      shard: worker.shard,
      endpoint: `${worker.host}:${worker.port}`,
      running: lines.some((line) => {
        const [name, status] = line.split('\t');
        return parseContainerShard(name) === worker.shard && status.toLowerCase().includes('up');
      }),
      state: 'running',
      shardCounts,
    }));
    return { workers: configured, error: null };
  }

  const discovered = lines.filter(Boolean).map((line) => {
    const [name, status] = line.split('\t');
    const running = status.toLowerCase().includes('up');
    const shard = parseContainerShard(name);
    return localNodeView({
      id: name,
      host: name,
      port: 0,
      shard,
      endpoint: name,
      running,
      state: running ? 'running' : 'exited',
      shardCounts,
    });
  });
  return { workers: discovered, error: discovered.length === 0 ? fleetFaults([configuredFault, emitterFault]) : null };
}

/**
 * Every configured worker node with its live reading.
 *
 * Why the emitter first: it is the single service that pings every fleet shard —
 * local docker state plus TCP reachability, remotes included. The docker pass is
 * only the fallback for a host where the emitter itself cannot run.
 *
 * WHY an empty reading carries a fault: docker and the emitter can each come back with
 * nothing, and only the configuration says which of "no workers" and "unreadable
 * configuration" it is — a fault the caller must show rather than render as empty.
 */
export async function collectWorkerStats(): Promise<WorkerFleet> {
  try {
    const shardCounts = await loadShardCounts();
    const emitter = await loadEmitterRowsOrNull();
    if (emitter.rows !== null) return { workers: mapEmitterRowsToNodes(emitter.rows, shardCounts), error: null };
    return await collectFromDocker(shardCounts, emitter.fault);
  } catch (error) {
    console.error('Failed to get worker stats:', error);
    // Why the fault is named here: a shard-count or collector read that threw left no reading at
    // all, and returning an empty list beside a null fault reports that as a fleet with no workers.
    return { workers: [], error: collectorFault('Worker status could not be collected', error) };
  }
}
