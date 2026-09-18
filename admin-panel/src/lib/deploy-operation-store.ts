import 'server-only';

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { DEPLOY_EFFECT_LEASE_MS, DEPLOY_LOG_ACTIVITY_MS, DEPLOY_STALE_MS, DEPLOY_UNOBSERVABLE_MS } from '@/lib/constants/deploy';
import { getRepoRoot } from '@/lib/repo-root';

/** The four files one operation's lifecycle is recorded in. */
type DeployOperationPaths = {
  metaPath: string;
  logPath: string;
  donePath: string;
  errorPath: string;
};

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

const getDeployLogsDir = (): string => path.join(getRepoRoot(), 'logs', 'deploy');

export async function ensureDeployLogsDir(): Promise<void> {
  await fs.mkdir(getDeployLogsDir(), { recursive: true });
}

export function generateOperationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function getDeployOperationPaths(operationId: string): DeployOperationPaths {
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

/**
 * Frees the deploy guard — and only while it is still this operation's.
 *
 * Why the check: the guard is what keeps a second deploy's `config.toml` write out of the one that is
 * settling, and every path that finishes with an operation releases it (the completed and failed settles,
 * a lookup that reports an outcome whose effects already ran, the spawn that never started, the cleanup).
 * Without the check, a settle of an operation the guard has already moved past unlinks the *newer*
 * operation's lock — after which that deploy can start while this one is still inside the read-then-write
 * window of its own revert (see deploy-store's `revertOwnedContestId`), and its write is reverted to this
 * operation's snapshot.
 *
 * What this does not close: the read and the unlink are two filesystem calls, so a caller that reads
 * "the guard is mine" and loses it before the unlink still removes a newer operation's lock. No
 * primitive here takes and releases the lock in one operation, and the writer that could win in
 * between is another panel process (see `withMetaMutation`), not a concurrent request in this one.
 */
export async function clearActiveOperation(operationId: string): Promise<void> {
  if ((await getActiveOperationId()) !== operationId) return;
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
 * The answer to "may I run this outcome's effects, and for which outcome".
 *
 * - `yours`: nothing has claimed this operation, or the settler that did never finished and its lease
 *   has run out — the effects are this caller's to run, and `outcome` is what to run them for (the
 *   record's own outcome when taking over, not the caller's, so a recovery applies what was claimed);
 * - `reported`: nothing is this caller's to run. `outcome` is the result to report. `applied` says which
 *   of the two reasons applies: `true` — the effects are done; `false` — another settler's claim is still
 *   inside its lease, so those effects may be running right now and must not be started alongside it.
 */
export type OutcomeClaim =
  | { kind: 'yours'; outcome: DeployOutcome }
  | { kind: 'reported'; outcome: DeployOutcome; applied: boolean };

/**
 * When the claim on a record started running its effects, or null when the record cannot say. A missing
 * stamp is a claim written by a panel older than the field; an unparseable one is a stamp this panel
 * cannot read. Neither can be shown to have been abandoned, which is why `claimDeployOutcome` dates it
 * rather than reading it as expired.
 */
function claimTimestamp(meta: DeployMeta): number | null {
  if (meta.outcomeClaimedAt === undefined) return null;
  const claimedAt = Date.parse(meta.outcomeClaimedAt);
  return Number.isNaN(claimedAt) ? null : claimedAt;
}

/**
 * Takes the claim on an operation's outcome — the only caller allowed to perform its side effects
 * (activating a contest, reverting config.toml, notifying Discord, running the config sync).
 *
 * What the claim buys: settling is reachable concurrently from the status stream of every open tab, the
 * 30s discovery lookup and the pre-guard reconcile, and writing the claim first is what makes a second
 * settler read "someone else's" instead of activating, notifying and syncing alongside this one. That
 * exclusion holds while the claim is held — it is not a promise that the effects run exactly once. A
 * settler that crashes after claiming leaves them to be taken over (below), and taking one over runs them
 * again; the last paragraph is why that is acceptable, and it is what a caller may rely on.
 *
 * Why a lease and not just "a claim is a claim": a crash between the claim and the effects leaves an
 * outcome on the record that nothing would ever apply — the contest never activated while every lookup
 * reported success, or config.toml keeping a contest the rollback never reverted. Deleting the record
 * later is not recovery. So an unapplied claim is taken over once it is older than
 * `DEPLOY_EFFECT_LEASE_MS`, which is far longer than the effects themselves and far shorter than an
 * operator's patience. Taking one over re-stamps the lease, which is what stops two concurrent lookups
 * in this process from both deciding they own the effects.
 *
 * Why a claim that cannot be dated is stamped instead of taken over: the record of an operation in flight
 * across an upgrade carries no stamp, because the field did not exist when it was written. Reading that as
 * expired hands the effects to whichever lookup asks first for *every* such record at once, repeating an
 * activation (and its audit row), a revert, a config sync and a Discord notice for each of them. Stamping
 * it with the first sighting starts its lease there instead: nothing is re-run on the way in, and the
 * effects are still recovered one lease later if nobody ever finished them.
 *
 * What a taken-over claim can re-run, and why that is the lesser evil: an activation is a set, the
 * revert is guarded by the contest id the file still has to name (see `rollbackContestId`), and a
 * Discord notice can repeat. The alternative — never applying what the record says happened — leaves
 * the panel asserting a state the system is not in, which is what this module exists to prevent.
 */
export async function claimDeployOutcome(operationId: string, outcome: DeployOutcome): Promise<OutcomeClaim> {
  return withMetaMutation(operationId, async () => {
    const meta = await readDeployMeta(operationId);
    // The record is gone: there is nothing left to claim or to mark applied, and refusing to run the
    // effects would drop an activation on the floor. Same answer the claim gave before this type existed.
    if (meta === null) return { kind: 'yours', outcome };
    const recorded = meta.outcome;
    if (recorded !== undefined) {
      if (meta.outcomeAppliedAt !== undefined) return { kind: 'reported', outcome: recorded, applied: true };
      const claimedAt = claimTimestamp(meta);
      if (claimedAt === null) {
        await writeDeployMeta(operationId, { ...meta, outcomeClaimedAt: new Date().toISOString() });
        return { kind: 'reported', outcome: recorded, applied: false };
      }
      if (Date.now() - claimedAt <= DEPLOY_EFFECT_LEASE_MS) return { kind: 'reported', outcome: recorded, applied: false };
      await writeDeployMeta(operationId, { ...meta, outcomeClaimedAt: new Date().toISOString() });
      return { kind: 'yours', outcome: recorded };
    }
    await writeDeployMeta(operationId, { ...meta, outcome, outcomeClaimedAt: new Date().toISOString() });
    return { kind: 'yours', outcome };
  });
}

/**
 * Records that a claim's effects have finished, which is what a later panel reads instead of running
 * them again. Called by the claim's owner only, and before it releases the deploy guard: the state that
 * must not exist is a free guard over effects that have not landed.
 *
 * `outcome` replaces the claim when the effect's result is its own — a rollback that failed is the
 * outcome, not a warning on the claim that preceded it.
 */
export async function markDeployOutcomeApplied(operationId: string, outcome?: DeployOutcome): Promise<void> {
  await patchDeployMeta(operationId, {
    outcomeAppliedAt: new Date().toISOString(),
    ...(outcome === undefined ? {} : { outcome }),
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

/**
 * Marks our own command in a pid's argv, so a recycled pid cannot pass itself off as the deploy.
 *
 * Why this token and not `docker`: `docker` is in the argv of every compose invocation the panel makes
 * — the restarts, the compose status lookups, an operator's own shell — so a recycled pid running any
 * of them read as this deploy and kept a finished operation "running" behind it. `cms-deploy` is the
 * argv0 the panel hands its own deploy child (`spawn('sh', ['-c', script, 'cms-deploy', done, error])`,
 * see deploy-store's `launchDetachedDeploy`), which nothing else in the panel produces; the script that
 * child runs is multi-line and ends in `exit`, so the shell does not exec the deploy command away and
 * take that argv0 with it.
 */
const DEPLOY_COMMAND_MARKER = 'cms-deploy';

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
 * Absence is evidence for exactly one of the two ways the two process tables can fail to line up: a
 * record that names no table at all — written before the field existed, or on a platform with no /proc
 * to name one — leaves absence as the only thing there is to go on, which is what the panel acted on
 * before this field existed. A record that *does* name a table, read by a panel that cannot name its
 * own, is indeterminate instead: the answer to "is that table this one" is unavailable, and an
 * unavailable answer is not evidence of an end.
 */
function pidAbsenceIsEvidence(spawnedNamespace: string | undefined, currentNamespace: string | null): boolean {
  if (spawnedNamespace === undefined) return true;
  if (currentNamespace === null) return false;
  return spawnedNamespace === currentNamespace;
}

/**
 * The liveness probe's answers.
 *
 * - `alive`: the process exists and its command line is this deploy's own — the operation continues;
 * - `gone`: absence is evidence the recorded process ended, or there is no process to wait for;
 * - `unobservable`: the record names a process table this panel is not in, so nothing it can look at
 *   says whether the process ended — while the operation is younger than `DEPLOY_UNOBSERVABLE_MS`, or its
 *   log says the deploy is still being reported on (see `logShowsWriterActive`);
 * - `presumed-gone`: the same, past that bound and without that evidence — the one admission of an end
 *   this panel cannot witness.
 */
export type DeployProcessVerdict = 'alive' | 'gone' | 'unobservable' | 'presumed-gone';

/**
 * Whether an operation this panel cannot observe at all has waited past the bound that stands in for
 * the evidence it cannot get. Measured from `startedAt` — the deploy's own clock, which every panel
 * reads the same — rather than from the record's mtime, which each writer of the record moves.
 */
function waitedOutUnobservableBound(meta: DeployMeta): boolean {
  return Date.now() - new Date(meta.startedAt).getTime() > DEPLOY_UNOBSERVABLE_MS;
}

/**
 * Whether something is still writing an operation's log, i.e. the deploy is still producing output.
 *
 * Why this is evidence, and whose: an operation's log has one writer — the panel that spawned the deploy,
 * which pipes the child's output into it (deploy-store's `launchDetachedDeploy`). Its mtime moving means
 * that panel is alive, which is the panel whose process table this record's pid came from, so the case the
 * unobservable bound cannot see into is exactly the case this can: a *second* panel container building
 * while this one holds an unobservable record for it. Why silence is not the mirror image of this — the
 * build is not necessarily dead once its output stops (a step can work silently for minutes) — is why this
 * only ever defers the bound and never ends an operation by itself.
 */
async function logShowsWriterActive(operationId: string): Promise<boolean> {
  const stats = await fs.stat(getDeployOperationPaths(operationId).logPath).catch(() => null);
  if (stats === null) return false;
  return Date.now() - stats.mtimeMs <= DEPLOY_LOG_ACTIVITY_MS;
}

/**
 * What this panel can say about the process an operation recorded.
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
 * Which way each answer fails, because a terminal answer reverts config.toml and frees the deploy
 * guard, so only evidence of an actual end may produce one:
 *  - no usable pid: `gone` — there is no process to wait for;
 *  - the process exists: `alive`, unless its command line names something else, which is a recycled pid
 *    rather than this deploy. An unreadable `/proc/<pid>/cmdline` (a host without /proc) leaves
 *    existence as the only evidence and answers `alive`;
 *  - EPERM: `alive` — the process exists, we are just not allowed to signal it;
 *  - ESRCH: evidence, unless the record names the process table the pid came from and this panel is not
 *    in it (see `pidAbsenceIsEvidence`). After the panel's container is recreated, the recorded pid
 *    belongs to the panel that is gone, and a build the docker daemon is still running looks exactly
 *    like a pid that ended;
 *  - that ESRCH with a foreign table: `unobservable` while the operation is younger than
 *    `DEPLOY_UNOBSERVABLE_MS` *or* its log is still being written to, `presumed-gone` past the bound with
 *    a silent log. Both halves are deliberate: an indeterminate answer is never an immediate verdict, and
 *    the bound is what stops a record whose process table no longer exists from holding the guard for good
 *    — nothing else in the panel can end it. The log is checked only there, at the bound, because it is
 *    the one thing that separates "the container that owned this is gone" from "a second panel container
 *    is building against this shared logs directory right now", which the bound on its own cannot tell
 *    apart (see `DEPLOY_UNOBSERVABLE_MS` and `DEPLOY_LOG_ACTIVITY_MS`);
 *  - anything else the kernel reports (EACCES, EINVAL, ENOSYS…): `alive` — a probe we could not
 *    interpret is not evidence, and guessing "dead" here is what reverted a live deploy's config.
 */
export async function probeDeployProcess(operationId: string, meta: DeployMeta): Promise<DeployProcessVerdict> {
  const pid = meta.pid;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return 'gone';
  const spawnedNamespace = meta.pidNamespace;
  const currentNamespace = await readPidNamespace();
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return 'alive';
    if (code === 'ESRCH') {
      if (pidAbsenceIsEvidence(spawnedNamespace, currentNamespace)) return 'gone';
      if (!waitedOutUnobservableBound(meta)) return 'unobservable';
      return (await logShowsWriterActive(operationId)) ? 'unobservable' : 'presumed-gone';
    }
    return 'alive';
  }
  const commandLine = await fs.readFile(`/proc/${pid}/cmdline`, 'utf-8').catch(() => null);
  if (commandLine === null) return 'alive';
  return commandLine.includes(DEPLOY_COMMAND_MARKER) ? 'alive' : 'gone';
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
 *
 * Why an unapplied claim blocks it too: the record is the only thing that says the effects are still
 * owed, so deleting it is not recovery — it is the loss of the activation or the revert the panel was
 * still going to apply (see `claimDeployOutcome`).
 *
 * Why the probe's answer and not the record's age decides the rest: an aged record whose process table
 * this panel is not in is discarded only once the unobservable bound has passed *and* its log has gone
 * silent (see `probeDeployProcess`), because until then it is indistinguishable from a deploy that is
 * still building in a container this panel cannot look into.
 *
 * Why the guard is released before the record it belongs to is unlinked: a crash between the two then
 * leaves a record with no guard, which the next pass discards and which refuses nothing, instead of a
 * guard naming a record that does not exist. The other order — the one this replaced — leaves the panel
 * with no way back: this enumeration only ever sees `*.json`, so an orphaned guard is invisible to it,
 * `runDeployContest` refuses every deploy while the guard is set, and the mount lookup reports no
 * operation at all. The first pass below (`releaseGuardWithNoRecord`) is what recovers a guard already
 * left in that state.
 */
export async function cleanStaleOperations(): Promise<void> {
  const dir = getDeployLogsDir();
  await releaseGuardWithNoRecord();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  for (const jsonFile of files.filter((file) => file.endsWith('.json'))) {
    const operationId = jsonFile.replace('.json', '');
    const meta = await readDeployMeta(operationId);
    if (meta === null) continue;
    if (Date.now() - new Date(meta.startedAt).getTime() <= DEPLOY_STALE_MS) continue;
    const verdict = await probeDeployProcess(operationId, meta);
    // Why both of the deferring verdicts exist here: `alive` is a deploy that is still building, and
    // `unobservable` is one this panel cannot rule out at all — the same two reasons the status
    // resolution keeps reporting it as running. `presumed-gone` is the bound's answer, not a witness's.
    if (verdict === 'alive' || verdict === 'unobservable') continue;
    if (meta.outcome !== undefined && meta.outcomeAppliedAt === undefined) continue;
    if (meta.outcome === undefined) {
      const { donePath, errorPath } = getDeployOperationPaths(operationId);
      const exists = async (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);
      if ((await exists(donePath)) || (await exists(errorPath))) continue;
    }
    // Before the record goes, and ownership-checked inside, so a guard that has already moved on to a
    // newer operation survives.
    await clearActiveOperation(operationId);
    await fs.unlink(path.join(dir, `${operationId}.json`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.log`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.done`)).catch(() => {});
    await fs.unlink(path.join(dir, `${operationId}.error`)).catch(() => {});
  }
}

/**
 * Frees the deploy guard when the operation it names has no record to guard.
 *
 * Why this exists: the guard and the record are released by two filesystem calls, so a panel that dies
 * between them — or a container that is recreated there — leaves a guard naming an operation whose record
 * is gone. Nothing else recovers from that state: the enumeration above only sees `*.json`, so it never
 * finds the guard; `runDeployContest` refuses every deploy while any guard is set; and the mount lookup
 * answers "no operation", because there is no metadata to report. The panel is then locked out with
 * nothing in the UI to explain it, which is the state this whole path exists to keep out of reach.
 *
 * What counts as "no record": one that cannot be read, including one whose contents do not parse. Both
 * leave the guard with nothing behind it and the panel equally unable to say what the operation was, and
 * the alternative — leaving the guard set — is the lockout above.
 */
async function releaseGuardWithNoRecord(): Promise<void> {
  const operationId = await getActiveOperationId();
  if (operationId === null) return;
  if ((await readDeployMeta(operationId)) !== null) return;
  await clearActiveOperation(operationId);
}
