import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEPLOY_EFFECT_LEASE_MS, DEPLOY_STALE_MS, DEPLOY_UNOBSERVABLE_LABEL, DEPLOY_UNOBSERVABLE_MS, DEPLOY_WALL_TIMEOUT_MS } from '@/lib/constants/deploy';
import { claimDeployOutcome, cleanStaleOperations, patchDeployMeta, recordDeployOperationStart } from '@/lib/deploy-operation-store';
import type { ContestDeployPlan } from '@/lib/deploy-store';

/**
 * A `config.toml` read or write the store is holding, so a test can act in the window between the
 * settle's ownership check and its write — the window a settlement has to keep a deploy out of.
 */
interface ConfigGate {
  /** Resolves once the store is inside the call, i.e. past its ownership check. */
  entered: Promise<void>;
  markEntered: () => void;
  /** Lets the held call through. */
  released: Promise<void>;
  release: () => void;
}

/**
 * The deploy store's lifecycle, driven through the real filesystem it records operations in.
 *
 * Why the mocks: `server-only` is a bundler marker no test can resolve, the compose process would
 * otherwise run docker, and activation/Discord are the two external effects under assertion. The
 * process itself is real — the store decides "still running" from the process it spawned, so a fake
 * pid would test nothing.
 */
const mocks = vi.hoisted(() => ({
  activateContest: vi.fn(),
  logToDiscord: vi.fn(),
  exec: vi.fn(),
  spawn: vi.fn(),
  realSpawn: null as typeof import('node:child_process').spawn | null,
  /** The script the store asked the fake spawn to run. */
  script: '',
  helpers: [] as Array<{ pid: number | undefined; kill: () => void; exited: Promise<void> }>,
  /** Set by armConfigWritePause / armConfigReadPause, consumed by the mocked calls below. */
  configWriteGate: null as null | ConfigGate,
  configReadGate: null as null | ConfigGate,
  /** Makes the mocked readlink below fail for this process's own pid namespace. */
  pidNamespaceReadFails: false,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/discord-notifier', () => ({ logToDiscord: mocks.logToDiscord }));

vi.mock('@/app/actions/contests', () => ({ activateContest: mocks.activateContest }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { PassThrough } = await import('node:stream');
  mocks.realSpawn = actual.spawn;
  mocks.spawn.mockImplementation((_file: string, args: string[]) => {
    mocks.script = args[1] ?? '';
    // A real, live process carrying what the panel's own spawn hands its child — the deploy script as
    // argv, `cms-deploy` as argv0 (see launchDetachedDeploy) — so the store's liveness probe sees the
    // process it recorded. Two commands keep the shell from exec'ing the sleep away, which would
    // replace that argv.
    const helper = actual.spawn('sh', ['-c', `sleep 20; true # ${mocks.script}`, 'cms-deploy'], { stdio: 'ignore' });
    helper.unref();
    mocks.helpers.push({
      pid: helper.pid,
      kill: (): void => { helper.kill('SIGKILL'); },
      exited: new Promise<void>((resolve) => { helper.once('exit', () => resolve()); }),
    });
    return {
      pid: helper.pid,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      on: (event: string, handler: (code: number | null) => void): void => {
        if (event === 'close') helper.once('exit', (code) => handler(code));
      },
      unref: (): void => {},
    };
  });
  return { ...actual, exec: mocks.exec, spawn: mocks.spawn };
});

/**
 * Wraps the one filesystem call a test needs to hold: the store's write of `config.toml`.
 *
 * Why this is the interposition point: the settle reads the file to decide the rollback is still its
 * to make, and writes it immediately after. Holding the write is the only way to observe what a
 * settlement does with the file once a newer deploy has taken it.
 *
 * The read side is wrapped for the same reason in the other direction: the store re-reads `config.toml`
 * just before it writes, so a test that holds that read can act in the window between the settle's
 * ownership check and its write — which is where a panel edit that is not guard-gated can land.
 */
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const writeFile = async (file: unknown, ...rest: unknown[]): Promise<void> => {
    const gate = mocks.configWriteGate;
    if (gate !== null && typeof file === 'string' && file.endsWith('config.toml')) {
      // Only the first gated write pauses: a released gate lets later writers through.
      mocks.configWriteGate = null;
      gate.markEntered();
      await gate.released;
    }
    return (actual.writeFile as (...args: unknown[]) => Promise<void>)(file, ...rest);
  };
  const readFile = async (file: unknown, ...rest: unknown[]): Promise<unknown> => {
    const gate = mocks.configReadGate;
    if (gate !== null && typeof file === 'string' && file.endsWith('config.toml')) {
      // The read completes first, so the paused caller holds the content it read *before* the pause.
      const content = await (actual.readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
      mocks.configReadGate = null;
      gate.markEntered();
      await gate.released;
      return content;
    }
    return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
  };
  const readlink = async (file: unknown): Promise<string> => {
    if (mocks.pidNamespaceReadFails && file === '/proc/self/ns/pid') {
      throw new Error('ENOENT: this process cannot read its own pid namespace');
    }
    return (actual.readlink as (target: string) => Promise<string>)(String(file));
  };
  // Both import styles, because this runner resolves 'fs/promises' and 'node:fs/promises' to one
  // module: only `config.toml` is gated, so the test file's own reads and writes pass untouched.
  return { ...actual, writeFile, readFile, readlink, default: { ...actual, writeFile, readFile, readlink } };
});

type DeployStore = typeof import('@/lib/deploy-store');

let store: DeployStore;
let repoRoot = '';
const originalCwd = process.cwd();

const logsDir = (): string => path.join(repoRoot, 'logs', 'deploy');
const metaPath = (operationId: string): string => path.join(logsDir(), `${operationId}.json`);
const donePath = (operationId: string): string => path.join(logsDir(), `${operationId}.done`);
const errorPath = (operationId: string): string => path.join(logsDir(), `${operationId}.error`);
const lockPath = (): string => path.join(logsDir(), 'active.lock');

const plan: ContestDeployPlan = { files: '-f docker-compose.yml', mode: 'img', location: null };

async function readConfigContestId(): Promise<number | null> {
  const content = await fs.readFile(path.join(repoRoot, 'config.toml'), 'utf-8');
  const match = content.match(/CONTEST_ID\s*=\s*(\d+)/);
  return match === null ? null : Number.parseInt(match[1], 10);
}

async function readOrNull(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf-8').catch(() => null);
}

async function waitForFile(file: string): Promise<void> {
  await vi.waitFor(async () => {
    await expect(fs.access(file).then(() => true, () => false)).resolves.toBe(true);
  });
}

/**
 * What the deploy's own script writes when its command exits. The script is exercised for real in
 * "the deploy reports its own exit" below; the lifecycle tests only need the file to be there.
 */
async function deployReportsExit(operationId: string, code: number): Promise<void> {
  await fs.writeFile(code === 0 ? donePath(operationId) : errorPath(operationId), String(code));
}

async function killDeployProcesses(): Promise<void> {
  for (const helper of mocks.helpers) {
    helper.kill();
    await helper.exited;
  }
}

/** Ages the record and its log, so nothing under test can still be reacting to a fresh operation. */
async function ageOperation(operationId: string, ageMs: number): Promise<void> {
  const startedAt = new Date(Date.now() - ageMs);
  const meta = JSON.parse(await fs.readFile(metaPath(operationId), 'utf-8'));
  await fs.writeFile(metaPath(operationId), JSON.stringify({ ...meta, startedAt: startedAt.toISOString() }));
  await fs.utimes(path.join(logsDir(), `${operationId}.log`), startedAt, startedAt);
}

const ageOperationBaseline = (operationId: string): Promise<void> =>
  ageOperation(operationId, DEPLOY_WALL_TIMEOUT_MS + 60_000);

/** The record as it stands on disk, for the assertions that are about what the panel stored. */
async function readRecordedMeta(operationId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(metaPath(operationId), 'utf-8')) as Record<string, unknown>;
}

async function rewriteRecordedMeta(operationId: string, meta: Record<string, unknown>): Promise<void> {
  await fs.writeFile(metaPath(operationId), JSON.stringify(meta));
}

/** Holds the store's next `config.toml` write until the test releases it. */
function armConfigWritePause(): ConfigGate {
  return armConfigPause('configWriteGate');
}

/** Holds the store's next `config.toml` read until the test releases it. */
function armConfigReadPause(): ConfigGate {
  return armConfigPause('configReadGate');
}

function armConfigPause(slot: 'configWriteGate' | 'configReadGate'): ConfigGate {
  let markEntered = (): void => {};
  let release = (): void => {};
  const gate: ConfigGate = {
    entered: new Promise<void>((resolve) => { markEntered = resolve; }),
    markEntered: () => { markEntered(); },
    released: new Promise<void>((resolve) => { release = resolve; }),
    release: () => { release(); },
  };
  mocks[slot] = gate;
  return gate;
}

/** A pid this process table has seen exit, so probing it reports ESRCH rather than a live process. */
async function gonePid(): Promise<number> {
  const spawnReal = mocks.realSpawn;
  if (spawnReal === null) throw new Error('the real spawn was not captured');
  const child = spawnReal('sh', ['-c', 'true'], { stdio: 'ignore' });
  if (child.pid === undefined) throw new Error('the helper process reported no pid');
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  return child.pid;
}

/** The pid namespace this test runs in, i.e. the one a deploy spawned here is recorded against. */
async function readPidNamespace(): Promise<string> {
  return fs.readlink('/proc/self/ns/pid');
}

/**
 * A live process in this process table whose argv is *not* this panel's deploy — a recycled pid, e.g.
 * one of the compose invocations the panel makes elsewhere. The probe has to tell it from the deploy.
 */
async function liveImposterPid(argv0: string, commandLine: string): Promise<number> {
  const spawnReal = mocks.realSpawn;
  if (spawnReal === null) throw new Error('the real spawn was not captured');
  const child = spawnReal('sh', ['-c', `sleep 20; true # ${commandLine}`, argv0], { stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error('the imposter process reported no pid');
  mocks.helpers.push({
    pid: child.pid,
    kill: (): void => { child.kill('SIGKILL'); },
    exited: new Promise<void>((resolve) => { child.once('exit', () => resolve()); }),
  });
  return child.pid;
}

/**
 * What a crash between a claim and its effects leaves behind: the outcome on the record, the side
 * effects never run, and the process that took the claim gone. `claimAgeMs` is how far back the claim
 * is dated — a claim inside the lease is one another settler may still be working on.
 */
async function crashedAfterClaiming(operationId: string, outcome: { status: 'completed' | 'failed'; error?: string }, claimAgeMs: number): Promise<void> {
  await claimDeployOutcome(operationId, outcome);
  const recorded = await readRecordedMeta(operationId);
  await rewriteRecordedMeta(operationId, {
    ...recorded,
    outcomeClaimedAt: new Date(Date.now() - claimAgeMs).toISOString(),
  });
}

beforeAll(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-deploy-test-'));
  await fs.mkdir(path.join(repoRoot, 'admin-panel'));
  // getRepoRoot() resolves the parent of the panel's working directory, so the store writes here.
  process.chdir(path.join(repoRoot, 'admin-panel'));
  store = await import('@/lib/deploy-store');
});

afterAll(async () => {
  process.chdir(originalCwd);
  await fs.rm(repoRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  mocks.activateContest.mockReset();
  mocks.activateContest.mockResolvedValue({ success: true });
  mocks.logToDiscord.mockReset();
  mocks.helpers.length = 0;
  mocks.script = '';
  mocks.pidNamespaceReadFails = false;
  mocks.exec.mockImplementation((_command: string, _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: '', stderr: '' });
  });
  await fs.rm(path.join(repoRoot, 'logs'), { recursive: true, force: true });
  await fs.writeFile(path.join(repoRoot, 'config.toml'), '[contest]\nCONTEST_ID = 10\n# num\n');
});

afterEach(async () => {
  // A test that failed before releasing a held call must not leave the store waiting on it.
  mocks.configWriteGate?.release();
  mocks.configWriteGate = null;
  mocks.configReadGate?.release();
  mocks.configReadGate = null;
  await killDeployProcesses();
});

describe('contest deploy lifecycle', () => {
  it('keeps a deploy whose process outlives the watch timeouts, then activates it on its marker', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(started.success).toBe(true);
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;

    expect(await readOrNull(lockPath())).toBe(operationId);
    expect(await readConfigContestId()).toBe(12);

    // Quiet log and a running clock: this used to be a timeout that reverted config.toml, freed the
    // guard and left the still-building process unobserved.
    await ageOperationBaseline(operationId);

    const quiet = await store.fetchDeployStatus(operationId);
    expect(quiet.status).toBe('running');
    expect(mocks.activateContest).not.toHaveBeenCalled();
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBe(operationId);

    // The guard is still held, so a second deploy cannot interleave its writes with this one.
    const blocked = await store.runDeployContest(13, plan);
    expect(blocked).toMatchObject({ success: false, alreadyRunning: true });

    // The build finishes after the panel stopped watching: its own marker is the outcome, and it
    // activates the contest.
    await deployReportsExit(operationId, 0);
    await waitForFile(donePath(operationId));

    const completed = await store.fetchDeployStatus(operationId);
    expect(completed.status).toBe('completed');
    expect(mocks.activateContest).toHaveBeenCalledExactlyOnceWith(12);
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBeNull();

    // A settled operation repeats its result instead of repeating its effects.
    expect((await store.fetchDeployStatus(operationId)).status).toBe('completed');
    expect(mocks.activateContest).toHaveBeenCalledTimes(1);
  });

  it('settles an unobserved finished deploy, including through a panel that just restarted', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await deployReportsExit(operationId, 0);
    await waitForFile(donePath(operationId));

    // Nothing watched it. The next mount of the panel asks the only question it can ask — "is an
    // operation waiting for me?" — and that lookup has to leave the operation settled and the contest
    // active, not silently running behind a held guard.
    expect(await store.getActiveDeployOperation()).toBeNull();
    expect(mocks.activateContest).toHaveBeenCalledExactlyOnceWith(12);
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBeNull();

    // And a settled leftover no longer blocks the next deploy.
    const next = await store.runDeployContest(14, plan);
    expect(next.success).toBe(true);
  });

  it('settles a deploy whose process is gone without a result, and reverts the configuration', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    const failed = await store.fetchDeployStatus(operationId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('gone without reporting');
    // Only a deploy that will not complete reverts: the configuration and the database agree again.
    expect(mocks.activateContest).not.toHaveBeenCalled();
    expect(await readConfigContestId()).toBe(10);
    expect(await readOrNull(lockPath())).toBeNull();
    expect((await store.fetchDeployStatus(operationId)).status).toBe('failed');
  });

  it('never reverts a configuration a newer deploy owns', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    // A newer deploy has taken the file since: reverting this operation's replacement would make
    // config.toml and the database assert different contests.
    await fs.writeFile(path.join(repoRoot, 'config.toml'), '[contest]\nCONTEST_ID = 13\n');

    const failed = await store.fetchDeployStatus(operationId);
    expect(failed.status).toBe('failed');
    expect(await readConfigContestId()).toBe(13);
  });

  it('keeps a deploy out of the window between a settle\'s ownership check and its config write', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    const syncsBefore = mocks.exec.mock.calls.length;
    const spawnsBefore = mocks.spawn.mock.calls.length;

    // The settler holds `config.toml` after it decided the file is still its operation's to revert.
    const pause = armConfigWritePause();
    const settle = store.fetchDeployStatus(operationId);
    await pause.entered;

    // Everything the panel does concurrently reaches settling from here: another tab's status
    // stream, the 30s discovery lookup, the pre-guard reconcile.
    const secondSettle = store.fetchDeployStatus(operationId);
    const deploy = await store.runDeployContest(13, plan);

    // What refuses this deploy is the guard, not the claim: the settle releases `active.lock` only
    // after its config write, so no deploy starts behind a rollback that is still in flight — without
    // the guard, the deploy's write would land inside this settle's read-then-write window and be
    // reverted. (The claim is what the assertions after this one are about: it keeps the concurrent
    // settle from repeating the effects.)
    expect(deploy).toMatchObject({ success: false, alreadyRunning: true });
    expect(mocks.spawn.mock.calls.length - spawnsBefore).toBe(0);

    pause.release();
    const [settled, repeated] = await Promise.all([settle, secondSettle]);
    expect(settled.status).toBe('failed');
    // The second settler repeats the claimed result instead of reverting a second time.
    expect(repeated.status).toBe('failed');
    expect(mocks.exec.mock.calls.length - syncsBefore).toBe(1);
    expect(await readConfigContestId()).toBe(10);
    expect(await readOrNull(lockPath())).toBeNull();
  });

  it('reverts only its own key, keeping an edit another writer made in the meantime', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    // The settle reads config.toml to decide the rollback is still its own, and then writes. That read
    // is held here so an edit from another panel surface lands in the window between them — an
    // env:update, which the deploy guard does not gate (only a deploy takes it).
    const pause = armConfigReadPause();
    const settle = store.fetchDeployStatus(operationId);
    await pause.entered;
    await fs.writeFile(
      path.join(repoRoot, 'config.toml'),
      '[contest]\nCONTEST_ID = 12\n\n[notifications]\nDISCORD_WEBHOOK_URL = "https://example.test/hook"\n',
    );
    pause.release();

    const settled = await settle;
    expect(settled.status).toBe('failed');
    expect(await readConfigContestId()).toBe(10);
    // Writing back the snapshot the ownership check read reverts the whole file to a state it never had,
    // silently losing every key another writer put there.
    expect(await fs.readFile(path.join(repoRoot, 'config.toml'), 'utf-8')).toContain('DISCORD_WEBHOOK_URL');
  });

  it('frees the guard only while it is still this operation\'s own', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    // A newer operation holds the guard while this one settles — the state an unowned unlink produces
    // itself: releasing whoever holds the guard is how the newer deploy came to take it.
    const newerId = 'aaaaaaaaaaaaaaaa';
    await recordDeployOperationStart(newerId, { contestId: 13, startedAt: new Date().toISOString() });

    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    // Freeing it here would let the newer deploy write config.toml while this settle is inside its own
    // read-then-write window, and that write would be reverted to this operation's snapshot.
    expect(await readOrNull(lockPath())).toBe(newerId);
  });

  it('does not free a newer operation\'s guard when it activates its own contest', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    await deployReportsExit(operationId, 0);

    const newerId = 'bbbbbbbbbbbbbbbb';
    await recordDeployOperationStart(newerId, { contestId: 13, startedAt: new Date().toISOString() });

    const completed = await store.fetchDeployStatus(operationId);
    expect(completed.status).toBe('completed');
    expect(mocks.activateContest).toHaveBeenCalledExactlyOnceWith(12);
    // The activation is this operation's effect; the guard is the newer operation's to hold.
    expect(await readOrNull(lockPath())).toBe(newerId);
  });

  it('records a failed activation as a terminal result and gives the guard back', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await deployReportsExit(operationId, 0);
    await waitForFile(donePath(operationId));
    // The deploy path needs `deployment:deploy`; activating the contest needs `contest:switch`, which
    // the seeded registries grant to another role. So this is what a legitimate operator sees.
    mocks.activateContest.mockRejectedValue(new Error('Permission denied: contest:switch'));

    const failed = await store.fetchDeployStatus(operationId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('contest:switch');
    // Nothing is reverted: the containers and config.toml already run this contest.
    expect(await readConfigContestId()).toBe(12);
    // Terminal and recorded, so no later lookup retries the activation while holding the guard.
    expect((await readRecordedMeta(operationId)).outcome).toMatchObject({ status: 'failed' });
    expect(await readOrNull(lockPath())).toBeNull();

    const repeated = await store.fetchDeployStatus(operationId);
    expect(repeated.status).toBe('failed');
    expect(mocks.activateContest).toHaveBeenCalledTimes(1);
    // The guard being free is what lets the operator try again.
    expect((await store.runDeployContest(14, plan)).success).toBe(true);
  });

  it('never discards the marker of an outcome the panel has not applied', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    await deployReportsExit(operationId, 0);
    await ageOperation(operationId, DEPLOY_STALE_MS + 60_000);

    await cleanStaleOperations();

    // The record and its marker are the only surviving evidence that the deploy finished: discarding
    // them here is what left the contest inactive while config.toml and the containers named it.
    expect(await readOrNull(metaPath(operationId))).not.toBeNull();
    expect(await readOrNull(donePath(operationId))).toBe('0');
    expect(await readOrNull(lockPath())).toBe(operationId);

    // And the surviving record still settles, so the contest reaches its activated state.
    const completed = await store.fetchDeployStatus(operationId);
    expect(completed.status).toBe('completed');
    expect(mocks.activateContest).toHaveBeenCalledExactlyOnceWith(12);
    expect(await readOrNull(lockPath())).toBeNull();
  });

  it('keeps both fields when the pid and the outcome are written together', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;

    // The two writers of one record, started together: the spawn records the process it just
    // started while a status stream settles the operation. A read-merge-write that is not serialised
    // drops whichever field landed first — a lost pid shunts the operation into the ageing branch, a
    // lost outcome re-runs activation.
    await Promise.all([
      patchDeployMeta(operationId, { pid: 4_190_000 }),
      patchDeployMeta(operationId, { outcome: { status: 'completed' } }),
    ]);

    const recorded = await readRecordedMeta(operationId);
    expect(recorded.pid).toBe(4_190_000);
    expect(recorded.outcome).toMatchObject({ status: 'completed' });
  });

  it('does not take a pid this namespace cannot see as proof the deploy ended', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    const recorded = await readRecordedMeta(operationId);
    // The spawn records the process table the pid belongs to; that is what makes the probe below
    // answerable after a panel restart.
    expect(recorded.pidNamespace).toBe(await readPidNamespace());

    const pid = await gonePid();
    // The panel that started this deploy is gone (its container was recreated), so the record names a
    // pid from another process table: probing it here reports ESRCH, which says nothing about the
    // build. A probe that read this as "dead" is what reverted config.toml under a running build.
    await rewriteRecordedMeta(operationId, { ...recorded, pid, pidNamespace: 'pid:[4026531000]' });

    const status = await store.fetchDeployStatus(operationId);
    expect(status.status).toBe('running');
    expect(mocks.activateContest).not.toHaveBeenCalled();
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBe(operationId);

    // In the namespace the pid was recorded in, the same ESRCH is evidence: this table has seen the
    // shell that ran the deploy go away, so the operation settles and the file is reverted.
    await rewriteRecordedMeta(operationId, { ...recorded, pid, pidNamespace: await readPidNamespace() });

    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    expect(await readConfigContestId()).toBe(10);
    expect(await readOrNull(lockPath())).toBeNull();
  });

  it('reaches a terminal state for a record whose process table is gone, instead of wedging the panel', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    // The panel container was recreated mid-deploy: the deploy child was a process of the container
    // that is now gone, and the record's pid comes from a process table this panel is not in.
    await killDeployProcesses();
    const recorded = await readRecordedMeta(operationId);
    await rewriteRecordedMeta(operationId, { ...recorded, pid: await gonePid(), pidNamespace: 'pid:[4026531000]' });

    // Inside the bound the operation still holds the guard: an unobservable process is not proof of
    // death, and settling here is what once reverted a live deploy's configuration.
    const young = await store.fetchDeployStatus(operationId);
    expect(young.status).toBe('running');
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBe(operationId);

    // Past the bound the operation reaches a terminal state. Without this the panel reports running
    // forever, holds active.lock forever and refuses every later deploy as alreadyRunning.
    await ageOperation(operationId, DEPLOY_UNOBSERVABLE_MS + 60_000);
    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    expect(settled.error).toContain(DEPLOY_UNOBSERVABLE_LABEL);
    expect(mocks.activateContest).not.toHaveBeenCalled();
    expect(await readConfigContestId()).toBe(10);
    expect(await readOrNull(lockPath())).toBeNull();

    // The freed guard is what an operator needs back: the next deploy starts.
    expect((await store.runDeployContest(13, plan)).success).toBe(true);
  });

  it('never strands a deploy whose process this panel can still see, however long it runs', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;

    // Aged far past the bound that settles an unobservable record: this process is visible here, and a
    // visible process outranks any clock — the bound is about the record's process table, not its age.
    await ageOperation(operationId, DEPLOY_UNOBSERVABLE_MS + 60_000);

    const status = await store.fetchDeployStatus(operationId);
    expect(status.status).toBe('running');
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBe(operationId);

    // Neither does the cleanup discard it: the record is the only evidence this live deploy exists.
    await store.reconcileDeployOperations();
    expect(await readOrNull(metaPath(operationId))).not.toBeNull();
    expect(await readOrNull(lockPath())).toBe(operationId);
  });

  it('does not read an unanswerable liveness probe as proof the deploy ended', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    const recorded = await readRecordedMeta(operationId);
    await rewriteRecordedMeta(operationId, { ...recorded, pid: await gonePid(), pidNamespace: 'pid:[4026531000]' });

    // The record names a process table and this panel cannot read its own: whether the two are the same
    // table is unknowable, so the ESRCH says nothing either way. Reading it as "dead" is what reverted a
    // live deploy's configuration.
    mocks.pidNamespaceReadFails = true;
    const status = await store.fetchDeployStatus(operationId);
    mocks.pidNamespaceReadFails = false;

    expect(status.status).toBe('running');
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBe(operationId);
  });

  it('does not take a live process that merely mentions docker as the deploy', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    // A recycled pid in this table running one of the panel's own compose invocations: a process that
    // exists but is not this deploy, and existence alone cannot tell the two apart.
    const recorded = await readRecordedMeta(operationId);
    const imposter = await liveImposterPid('docker', 'docker compose -f docker-compose.yml ps');
    await rewriteRecordedMeta(operationId, { ...recorded, pid: imposter, pidNamespace: await readPidNamespace() });

    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    expect(settled.error).toContain('gone without reporting');
    expect(await readConfigContestId()).toBe(10);
  });

  it('still settles an ESRCH for a record that cannot name its process table', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    // A record written before the pid namespace was recorded (a deploy in flight across the upgrade),
    // or one from a host with no /proc: absence is all the panel has, and it is what it acted on
    // before this field existed.
    const recorded = await readRecordedMeta(operationId);
    const withoutNamespace: Record<string, unknown> = { ...recorded, pid: await gonePid() };
    delete withoutNamespace.pidNamespace;
    await rewriteRecordedMeta(operationId, withoutNamespace);

    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    expect(await readConfigContestId()).toBe(10);
    expect(await readOrNull(lockPath())).toBeNull();
  });

  it('runs the contest stack from the unified project, with the mode deciding build or pull', async () => {
    await store.runDeployContest(12, plan);
    // The retired per-stack docker-compose.contest.yml declared no image names, so this used to build
    // <project>-<service> images nothing else in the project builds or pulls.
    expect(mocks.script).toContain('docker compose -f docker-compose.yml --profile core --profile contest');
    expect(mocks.script).toContain(
      'up -d --no-build --force-recreate evaluation-service proxy-service contest-web-server nginx-proxy',
    );
    // Image deployments pull the registry images first, exactly as the Makefile's contest target does.
    expect(mocks.script).toContain(' pull evaluation-service proxy-service contest-web-server nginx-proxy || true) && docker compose');
    expect(mocks.script.indexOf('pull')).toBeLessThan(mocks.script.indexOf('up -d'));
    // The deploy writes its own outcome markers, from the paths handed to it as argv.
    expect(mocks.script).toContain('> "$1"');
    expect(mocks.script).toContain('> "$2"');
  });

  it('addresses the host project directory and builds in source mode', () => {
    const command = store.buildContestDeployCommand({
      files: '-f docker-compose.yml -f docker-compose.override.yml',
      mode: 'src',
      location: { projectDirectory: '/host/repo', envFile: '/host/repo/.env' },
    });
    expect(command).toBe(
      "docker compose --project-directory '/host/repo' --env-file '/host/repo/.env' -f docker-compose.yml -f docker-compose.override.yml --profile core --profile contest up -d --build --force-recreate evaluation-service proxy-service contest-web-server nginx-proxy",
    );
  });

  it('recovers a completed outcome whose effects never ran, instead of reporting success forever', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    await deployReportsExit(operationId, 0);
    // The panel claimed the outcome and then died before activating: the claim is on disk, so every
    // later lookup reads "already settled" and the contest is never activated.
    await claimDeployOutcome(operationId, { status: 'completed' });
    expect(mocks.activateContest).not.toHaveBeenCalled();

    // Inside the lease the claim is another settler's work in progress: the effects must not run twice.
    const held = await store.fetchDeployStatus(operationId);
    expect(held.status).toBe('completed');
    expect(mocks.activateContest).not.toHaveBeenCalled();

    // Past it, the claim is a settler that never came back, and what it owed is recoverable — the panel
    // mount path is what has to find it, because that is the only request an operator's browser makes.
    await crashedAfterClaiming(operationId, { status: 'completed' }, DEPLOY_EFFECT_LEASE_MS + 60_000);
    expect(await store.getActiveDeployOperation()).toBeNull();
    expect(mocks.activateContest).toHaveBeenCalledExactlyOnceWith(12);
    expect(await readConfigContestId()).toBe(12);
    expect(await readOrNull(lockPath())).toBeNull();
    expect(typeof (await readRecordedMeta(operationId)).outcomeAppliedAt).toBe('string');

    // And the recovered operation repeats its result without repeating its effects.
    expect((await store.fetchDeployStatus(operationId)).status).toBe('completed');
    expect(mocks.activateContest).toHaveBeenCalledTimes(1);
  });

  it('recovers a failed outcome whose rollback never ran', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();

    // The panel claimed the failure and died before reverting: config.toml keeps naming the contest
    // the deploy did not reach, while the database still has the previous one — the split this module
    // exists to prevent, and the one nothing retried once the outcome was on the record.
    await crashedAfterClaiming(operationId, { status: 'failed', error: 'Deploy process is gone without reporting a result.' }, DEPLOY_EFFECT_LEASE_MS + 60_000);
    expect(await readConfigContestId()).toBe(12);

    const settled = await store.fetchDeployStatus(operationId);
    expect(settled.status).toBe('failed');
    expect(settled.error).toBe('Deploy process is gone without reporting a result.');
    expect(await readConfigContestId()).toBe(10);
    expect(mocks.exec).toHaveBeenCalled();
    expect(await readOrNull(lockPath())).toBeNull();
    expect(await readRecordedMeta(operationId)).toMatchObject({ outcomeAppliedAt: expect.any(String) });
  });

  it('never discards a record whose claimed outcome still owes its effects', async () => {
    const started = await store.runDeployContest(12, plan);
    const operationId = started.operationId;
    expect(operationId).toBeDefined();
    if (operationId === undefined) return;
    await killDeployProcesses();
    await claimDeployOutcome(operationId, { status: 'failed', error: 'Deploy process is gone without reporting a result.' });
    await ageOperation(operationId, DEPLOY_STALE_MS + 60_000);

    await cleanStaleOperations();

    // Deleting the record is not recovery: it is what makes the rollback the operation still owes
    // impossible to find, and leaves config.toml naming a contest the database does not have.
    expect(await readOrNull(metaPath(operationId))).not.toBeNull();
    expect(await readOrNull(lockPath())).toBe(operationId);
  });

  it('has the deploy report its own exit, so the outcome survives the panel that started it', async () => {
    await fs.mkdir(logsDir(), { recursive: true });
    const run = async (inner: string): Promise<{ code: number | null; done: string | null; error: string | null }> => {
      const done = path.join(logsDir(), `script-${inner}.done`);
      const error = path.join(logsDir(), `script-${inner}.error`);
      const spawnReal = mocks.realSpawn;
      if (spawnReal === null) throw new Error('the real spawn was not captured');
      const code = await new Promise<number | null>((resolve) => {
        spawnReal('sh', ['-c', store.buildDeployScript(inner), 'cms-deploy', done, error], { stdio: 'ignore' })
          .once('exit', (exitCode) => resolve(exitCode));
      });
      return { code, done: await readOrNull(done), error: await readOrNull(error) };
    };

    const succeeded = await run('true');
    expect(succeeded).toMatchObject({ code: 0, done: '0', error: null });
    const refused = await run('false');
    expect(refused).toMatchObject({ code: 1, done: null, error: '1' });
  });
});
