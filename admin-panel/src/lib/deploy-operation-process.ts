import fs from 'fs/promises';

import { DEPLOY_LOG_ACTIVITY_MS, DEPLOY_UNOBSERVABLE_MS } from '@/lib/constants/deploy';
import { getDeployOperationPaths } from '@/lib/deploy-operation-paths';
import { patchDeployMeta, type DeployMeta } from '@/lib/deploy-operation-meta';

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
