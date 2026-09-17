import 'server-only';

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { DEPLOY_STALE_MS } from '@/lib/constants/deploy';
import { getRepoRoot } from '@/lib/repo-root';

export interface DeployPaths {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
}

/** The result the panel has already applied to an operation, with the copy it reported at the time. */
export interface DeployOutcome {
  status: 'completed' | 'failed';
  error?: string;
  warning?: string;
}

export type DeployMeta = {
  contestId: number;
  startedAt: string;
  previousContestId?: number;
  /**
   * The process running the deploy, as spawned by the panel. Absent only for a record whose process
   * the panel never saw — a record written by an older panel, or a spawn that reported no pid.
   */
  pid?: number;
  /**
   * The pid namespace `pid` was spawned in (`pid:[4026531836]`). Absent where the platform cannot
   * answer (no /proc) and on records written before this field existed. The liveness probe reads it to
   * tell a process that ended from a pid this panel's process table cannot see at all.
   */
  pidNamespace?: string;
  /**
   * Set once the outcome has been applied. Why on disk and not in memory: the settling has external
   * effects (activating a contest, reverting config.toml, notifying Discord) that must not happen
   * twice, and the panel that settles may not be the one that started the deploy.
   */
  outcome?: DeployOutcome;
};

export interface DeployOperation {
  operationId: string;
  meta: DeployMeta;
}

const getDeployLogsDir = (): string => path.join(getRepoRoot(), 'logs', 'deploy');

export async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

export function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function getDeployOperationPaths(operationId: string): DeployPaths {
  const logsDir = getDeployLogsDir();
  return {
    metaPath: path.join(logsDir, `${operationId}.json`),
    logPath: path.join(logsDir, `${operationId}.log`),
    donePath: path.join(logsDir, `${operationId}.done`),
    errorPath: path.join(logsDir, `${operationId}.error`),
  };
}

export async function getActiveOperationId(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(getDeployLogsDir(), 'active.lock'), 'utf-8');
  } catch {
    return null;
  }
}

export async function setActiveOperationId(operationId: string): Promise<void> {
  await fs.writeFile(path.join(getDeployLogsDir(), 'active.lock'), operationId, 'utf-8');
}

export async function clearActiveOperation(): Promise<void> {
  await fs.unlink(path.join(getDeployLogsDir(), 'active.lock')).catch(() => {});
}

export async function readDeployMeta(operationId: string): Promise<DeployMeta | null> {
  const raw = await fs.readFile(getDeployOperationPaths(operationId).metaPath, 'utf-8').catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DeployMeta;
  } catch {
    return null;
  }
}

/**
 * One in-flight mutation of an operation's record at a time, keyed by operation.
 *
 * Why: `patchDeployMeta` and `claimDeployOutcome` are read-modify-write on the same document, and the
 * panel writes one operation from several places at once — the spawn records its pid while a status
 * stream settles the operation, and every open tab polls. Interleaved read-merge-writes lose a field:
 * a dropped `pid` shunts the record into the ageing branch, a dropped `outcome` re-runs the
 * activation or the rollback. Chaining the mutations is what makes each one whole.
 *
 * Scope, because it decides how much the merge below can promise: this serialises the writers inside
 * *this* panel process, which is what serves a deploy's status stream, its discovery lookups and the
 * deploy request itself. Two panel processes sharing the log directory are not serialised against
 * each other.
 */
const metaMutationQueues = new Map<string, Promise<unknown>>();

function withMetaMutation<T>(operationId: string, mutation: () => Promise<T>): Promise<T> {
  const queued = (metaMutationQueues.get(operationId) ?? Promise.resolve()).then(mutation);
  // The queue holds a handled copy: a mutation that throws still lets the next writer take its turn.
  const tail = queued.then(() => undefined, () => undefined);
  metaMutationQueues.set(operationId, tail);
  void tail.then(() => {
    if (metaMutationQueues.get(operationId) === tail) metaMutationQueues.delete(operationId);
  });
  return queued;
}

/**
 * Replaces a record in one step, so a reader sees either the previous or the new document and never a
 * half-written one. The rename is why the temp file is a sibling: a rename across filesystems is a
 * copy, which is the torn read this exists to prevent.
 */
async function writeDeployMeta(operationId: string, meta: DeployMeta): Promise<void> {
  const { metaPath } = getDeployOperationPaths(operationId);
  const tempPath = `${metaPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(meta), 'utf-8');
  try {
    await fs.rename(tempPath, metaPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

/** Records the start of an operation and claims the guard in one step, before any work runs. */
export async function recordDeployOperationStart(operationId: string, meta: DeployMeta): Promise<void> {
  await writeDeployMeta(operationId, meta);
  await setActiveOperationId(operationId);
}

/**
 * Merges into the record on disk instead of writing a caller's copy of it.
 *
 * Why the merge: the panel patches the same operation from several places — the spawn adds its pid
 * while a watcher may be writing the outcome — and the settling flags must survive either write.
 *
 * What this guarantees, and no more: the read-merge-write runs under this process's per-operation
 * queue, so two patchers in this panel cannot drop each other's field, and the result is renamed into
 * place, so no reader ever sees a partial record. A second panel process writing the same record is
 * not covered by that queue (see `withMetaMutation`): the rename still keeps the file whole, but one
 * of the two processes' fields can be lost.
 */
export async function patchDeployMeta(operationId: string, patch: Partial<DeployMeta>): Promise<void> {
  await withMetaMutation(operationId, async () => {
    const meta = await readDeployMeta(operationId);
    if (meta === null) return;
    await writeDeployMeta(operationId, { ...meta, ...patch });
  });
}

/**
 * Writes an operation's terminal outcome, unless one is already recorded.
 *
 * Returns the outcome already on disk when another settler got there first, and `null` when this
 * caller won the claim — which is what makes it the only caller allowed to perform the operation's
 * side effects (activating a contest, reverting config.toml, notifying Discord, running the config
 * sync). The outcome goes down *before* those effects: a claim that is already on disk is what a
 * concurrent settler reads instead of starting a second rollback or a second activation.
 *
 * The claim records what is known before the effects run; the one effect whose result is its own
 * (a rollback that fails) is patched in by the winner afterwards, which is also the only writer of
 * that record from then on.
 */
export async function claimDeployOutcome(operationId: string, outcome: DeployOutcome): Promise<DeployOutcome | null> {
  return withMetaMutation(operationId, async () => {
    const meta = await readDeployMeta(operationId);
    if (meta === null) return null;
    if (meta.outcome !== undefined) return meta.outcome;
    await writeDeployMeta(operationId, { ...meta, outcome });
    return null;
  });
}

/** Every operation record the panel still holds. Records are independent, so order carries no meaning. */
export async function listDeployOperations(): Promise<DeployOperation[]> {
  const dir = getDeployLogsDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const operations: DeployOperation[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const operationId = file.slice(0, -'.json'.length);
    const meta = await readDeployMeta(operationId);
    if (meta !== null) operations.push({ operationId, meta });
  }
  return operations;
}

/** Marks our own command in a pid's argv, so a recycled pid cannot pass itself off as the deploy. */
const DEPLOY_COMMAND_MARKER = 'docker';

/** The pid namespace this process runs in, e.g. `pid:[4026531836]`. Null where /proc has no answer. */
async function readPidNamespace(): Promise<string | null> {
  return fs.readlink('/proc/self/ns/pid').catch(() => null);
}

/**
 * Records the process running the operation, together with the process table it belongs to.
 *
 * Why the namespace as well as the pid: a pid only means something inside the table that issued it.
 * Recording which table that was is what lets a later panel tell "the shell that ran the deploy
 * ended" from "this pid was never mine to see" — `kill(pid, 0)` reports both as ESRCH. The child
 * inherits this process's namespace at spawn and a namespace cannot change under a running process,
 * so reading it here names the child's table.
 */
export async function recordDeployProcess(operationId: string, pid: number | undefined): Promise<void> {
  await patchDeployMeta(operationId, { pid, pidNamespace: (await readPidNamespace()) ?? undefined });
}

/**
 * Whether an ESRCH from `kill(pid, 0)` is evidence that the recorded process ended.
 *
 * Absence is meaningless for exactly one case: the record names the process table the pid came from
 * and it is *not* the one this panel is looking at — after its container is recreated, absence there
 * says nothing about a build the docker daemon is still running. Every other case leaves absence as
 * evidence: the tables match, the record predates this field (a deploy in flight across the upgrade),
 * or the platform has no /proc to name a table at all.
 */
function pidAbsenceIsEvidence(spawnedNamespace: string | undefined, currentNamespace: string | null): boolean {
  return spawnedNamespace === undefined || currentNamespace === null || spawnedNamespace === currentNamespace;
}

/**
 * Whether the process this operation recorded is still running.
 *
 * Why the process at all: elapsed time and log silence cannot tell a working deploy from a dead one —
 * docker build spends minutes between output lines, and a full `up --build` can legitimately outlast
 * any clock we pick. The process exiting is what ends a deploy (and is what writes its marker).
 *
 * Why the argv check on top of `kill(pid, 0)`: a pid only means something inside the process table
 * that issued it. After the panel's container restarts, a recorded pid can belong to an unrelated
 * process — a bare existence probe would then keep a finished operation "running" indefinitely. A pid
 * that exists but does not carry this command is therefore not ours.
 *
 * Which way each answer fails, because `false` is the answer that reverts config.toml and frees the
 * deploy guard, so only evidence of an actual end may produce it:
 *  - the process exists: alive, unless its command line names something else, which is a recycled pid
 *    rather than this deploy. An unreadable `/proc/<pid>/cmdline` (a host without /proc) leaves
 *    existence as the only evidence and answers alive;
 *  - EPERM: alive — the process exists, we are just not allowed to signal it;
 *  - ESRCH: evidence, unless the record names the process table the pid came from and it is not this
 *    one (see `pidAbsenceIsEvidence`). After the panel's container is recreated, the recorded pid
 *    belongs to the panel that is gone, and a build the docker daemon is still running looks exactly
 *    like a pid that ended;
 *  - anything else the kernel reports (EACCES, EINVAL, ENOSYS…): alive — a probe we could not
 *    interpret is not evidence, and guessing "dead" here is what reverted a live deploy's config.
 */
export async function isDeployProcessAlive(meta: DeployMeta): Promise<boolean> {
  const pid = meta.pid;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return false;
  const spawnedNamespace = meta.pidNamespace;
  const currentNamespace = await readPidNamespace();
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return !pidAbsenceIsEvidence(spawnedNamespace, currentNamespace);
    return true;
  }
  const commandLine = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null);
  if (commandLine === null) return true;
  return commandLine.includes(DEPLOY_COMMAND_MARKER);
}

/**
 * Discards the records the panel has finished with.
 *
 * Why after settling and never while a process is alive: deleting a record is what forgets an
 * operation, so a record of a deploy that is still building — or one whose result has not been
 * applied yet — must survive. Reconciliation (deploy-store) settles first, which leaves only settled
 * records and operations with no process left to wait for.
 *
 * Why an unread marker blocks the delete even for an aged-out record: `.done`/`.error` is the only
 * surviving evidence that the deploy ended, so discarding it loses the activation (or the revert)
 * the operation still owes — which is how a finished deploy left the contest inactive while
 * config.toml and its containers named it.
 */
export async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const jsonFile of files.filter((file) => file.endsWith('.json'))) {
    const operationId = jsonFile.replace('.json', '');
    const meta = await readDeployMeta(operationId);
    if (meta === null) continue;
    if (Date.now() - new Date(meta.startedAt).getTime() <= DEPLOY_STALE_MS) continue;
    if (await isDeployProcessAlive(meta)) continue;
    if (meta.outcome === undefined) {
      const { donePath, errorPath } = getDeployOperationPaths(operationId);
      const exists = async (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);
      if ((await exists(donePath)) || (await exists(errorPath))) continue;
    }
    await fs.unlink(path.join(dir, `${operationId}.json`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.log`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.done`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.error`)).catch(() => {});
    if ((await getActiveOperationId()) === operationId) await clearActiveOperation();
  }
}
