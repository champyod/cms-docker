import crypto from 'crypto';
import fs from 'fs/promises';

import { getDeployLogsDir, getDeployOperationPaths, setActiveOperationId } from '@/lib/deploy-operation-paths';

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
   * Set once the outcome has been claimed, before its effects run. Why on disk and not in memory: the
   * settling has external effects (activating a contest, reverting config.toml, notifying Discord) that
   * two concurrent settlers must not run alongside each other, and the panel that settles may not be the
   * one that started the deploy. The claim is what excludes them while it is held; it is not a promise
   * that the effects run exactly once — see `claimDeployOutcome` for what a crash lets them re-run.
   */
  outcome?: DeployOutcome;
  /**
   * When the claim above was written: the lease its effects are running under. A claim whose effects are
   * still absent this long after it was taken was made by a settler that is gone (see
   * `claimDeployOutcome`), which is what keeps a crash between the claim and its effects recoverable
   * instead of becoming a permanently unapplied outcome.
   */
  outcomeClaimedAt?: string;
  /**
   * Set once the claim's effects have finished — the completion marker, distinct from the claim. Its
   * absence next to a claim is what says the effects are still owed, so a later panel can run them
   * rather than reading "settled" and reporting a result that never happened.
   */
  outcomeAppliedAt?: string;
  /**
   * The contest the database was left on, written when a completed deploy's activation ran. Why on the
   * record: `is_active` is moved by the activation and by nothing else this path can observe, so the
   * operation's own artifacts are the only place an operator can read what is active in the database
   * without querying it. Absent while the effects are owed, and absent for an operation that left the
   * database alone — a rollback, or an activation that failed before it wrote.
   */
  activatedContestId?: number;
};

export interface DeployOperation {
  operationId: string;
  meta: DeployMeta;
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
 * deploy request itself. Two panel processes sharing the log directory are not serialised against each
 * other.
 */
const metaMutationQueues = new Map<string, Promise<unknown>>();

export function withMetaMutation<T>(operationId: string, mutation: () => Promise<T>): Promise<T> {
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
export async function writeDeployMeta(operationId: string, meta: DeployMeta): Promise<void> {
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
