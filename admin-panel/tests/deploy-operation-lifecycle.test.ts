import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DEPLOY_STALE_MS, DEPLOY_WALL_TIMEOUT_MS } from '@/lib/constants/deploy';
import { cleanStaleOperations, patchDeployMeta } from '@/lib/deploy-operation-store';
import type { ContestDeployPlan } from '@/lib/deploy-store';

/**
 * A `config.toml` write the store is holding, so a test can act in the window between the settle's
 * ownership check and its write — the window a settlement has to keep a deploy out of.
 */
interface ConfigWriteGate {
  /** Resolves once the store is inside the write, i.e. past its ownership check. */
  entered: Promise<void>;
  markEntered: () => void;
  /** Lets the held write through. */
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
  /** Set by armConfigWritePause, consumed by the mocked writeFile below. */
  configWriteGate: null as null | ConfigWriteGate,
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
    // A real, live process carrying "docker" in its argv, so the store's liveness probe sees the
    // process it recorded. Two commands keep the shell from exec'ing the sleep away, which would
    // replace that argv.
    const helper = actual.spawn('sh', ['-c', `sleep 20; true # ${mocks.script}`], { stdio: 'ignore' });
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
  // Both import styles, because this runner resolves 'fs/promises' and 'node:fs/promises' to one
  // module: only `config.toml` writes are gated, so the test file's own writes pass untouched.
  return { ...actual, writeFile, default: { ...actual, writeFile } };
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
function armConfigWritePause(): ConfigWriteGate {
  let markEntered = (): void => {};
  let release = (): void => {};
  const gate: ConfigWriteGate = {
    entered: new Promise<void>((resolve) => { markEntered = resolve; }),
    markEntered: () => { markEntered(); },
    released: new Promise<void>((resolve) => { release = resolve; }),
    release: () => { release(); },
  };
  mocks.configWriteGate = gate;
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
  mocks.exec.mockImplementation((_command: string, _options: unknown, callback: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
    callback(null, { stdout: '', stderr: '' });
  });
  await fs.rm(path.join(repoRoot, 'logs'), { recursive: true, force: true });
  await fs.writeFile(path.join(repoRoot, 'config.toml'), '[contest]\nCONTEST_ID = 10\n# num\n');
});

afterEach(async () => {
  // A test that failed before releasing the held write must not leave the store waiting on it.
  mocks.configWriteGate?.release();
  mocks.configWriteGate = null;
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

    // The settle claimed the operation before it touched anything, so the deploy is not started
    // behind a rollback that is still in flight — which is how config.toml, the database and the
    // containers used to end up naming different contests.
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
