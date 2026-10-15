import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  groupBy: vi.fn(),
  repoRoot: '',
}));

vi.mock('child_process', () => ({ exec: mocks.exec, execFile: mocks.execFile }));
vi.mock('@/lib/prisma', () => ({ prisma: { evaluations: { groupBy: mocks.groupBy } } }));
vi.mock('@/lib/repo-root', () => ({ getRepoRoot: (): string => mocks.repoRoot }));

import { collectWorkerStats } from '@/lib/worker-stats';

type ExecResult = { stdout: string; stderr: string };
type ExecCallback = (error: Error | null, result: ExecResult) => void;

const CONFIGURED_WORKERS_TOML = '[worker]\nWORKER_0 = "cms-worker-0:26000"\nWORKER_1 = "cms-worker-1:26001"\n';
// The config.toml form the fleet TUI writes: a quoted value, and a row ending in a comment.
const STALE_FLEET_TOML = '[worker]\nWORKER_4 = "10.0.0.4:26004" # note\nWORKER_6 = "10.0.0.6:26006"\n';
const DOCKER_PS = 'cms-worker-0\tUp 2 hours\ncms-worker-1\tExited (0) 1 hour ago';

/** Why the callback is the second argument: promisify appends it to the single command it is given. */
function execSucceeds(stdout: string): (command: string, callback: ExecCallback) => void {
  return (_command: string, callback: ExecCallback): void => {
    callback(null, { stdout, stderr: '' });
  };
}

function execFileSucceeds(stdout: string): (file: string, args: string[], options: unknown, callback: ExecCallback) => void {
  return (_file: string, _args: string[], _options: unknown, callback: ExecCallback): void => {
    callback(null, { stdout, stderr: '' });
  };
}

let repoRoot = '';

/** The fleet the panel reads: config.toml, the file the fleet TUI and the settings screen write. */
function seedConfigToml(content: string): void {
  fs.writeFileSync(path.join(repoRoot, 'config.toml'), content);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-worker-stats-'));
  mocks.repoRoot = repoRoot;
  mocks.exec.mockReset();
  mocks.execFile.mockReset();
  mocks.groupBy.mockReset();
  mocks.groupBy.mockResolvedValue([]);
  mocks.exec.mockImplementation(execSucceeds(DOCKER_PS));
  mocks.execFile.mockImplementation(execFileSucceeds('[]'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Why the fallback is asserted through docker's answer: an emitter that returns `[]` has not said the
 * fleet is empty, so the only honest alternatives are the docker-derived list or a named failure.
 */
describe('collectWorkerStats with a degraded emitter', () => {
  it('reads the fleet from docker when the emitter reports no workers', async () => {
    seedConfigToml(CONFIGURED_WORKERS_TOML);

    const { workers: nodes } = await collectWorkerStats();

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(nodes.map((node) => node.id)).toEqual(['worker-0', 'worker-1']);
    expect(nodes[0].connection).toBe('connected');
    expect(nodes[1].connection).toBe('disconnected');
  });

  it('still falls back when the emitter cannot run at all', async () => {
    seedConfigToml(CONFIGURED_WORKERS_TOML);
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback): void => {
      callback(new Error('EACCES: permission denied'), { stdout: '', stderr: '' });
    });

    const { workers: nodes } = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-0', 'worker-1']);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it('uses the emitter fleet, and docker not at all, when the emitter reports one', async () => {
    mocks.execFile.mockImplementation(execFileSucceeds(JSON.stringify([
      { shard: 7, endpoint: 'cms-worker-7:26007', state: 'running', reachable: true },
    ])));

    const { workers: nodes } = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-7']);
    expect(nodes[0].connection).toBe('connected');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});

/**
 * Why the fleet is read from two places: config.toml is the file the panel writes, and the panel
 * container is handed only what compose delivers — so the environment outranks the config. The
 * generated .env is a render of config.toml, so a shard living only there is a stale copy.
 */
describe('collectWorkerStats fleet sources', () => {
  it('reads the fleet from config.toml alone, ignoring a stale .env render', async () => {
    fs.writeFileSync(path.join(repoRoot, '.env'), 'WORKER_9=stale.example:9999\n');
    seedConfigToml(STALE_FLEET_TOML);

    const { workers: nodes } = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-4', 'worker-6']);
  });

  it('reads config.toml when the environment is silent', async () => {
    seedConfigToml(STALE_FLEET_TOML);

    const { workers: nodes } = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-4', 'worker-6']);
    expect(nodes.map((node) => node.endpoint)).toEqual(['10.0.0.4:26004', '10.0.0.6:26006']);
  });

  it('lets the environment win over config.toml', async () => {
    seedConfigToml(STALE_FLEET_TOML);
    vi.stubEnv('WORKER_4', '10.9.9.9:26999');

    const { workers: nodes } = await collectWorkerStats();

    expect(nodes.find((node) => node.id === 'worker-4')?.endpoint).toBe('10.9.9.9:26999');
  });

  /**
   * Why this is the whole point of the read: docker reporting nothing is not evidence of an empty
   * fleet when the configuration itself could not be opened — that is a read fault, and it must be
   * named rather than rendered as "No worker nodes configured".
   */
  it('names an unreadable config.toml instead of rendering an empty fleet', async () => {
    const configPath = path.join(repoRoot, 'config.toml');
    fs.mkdirSync(configPath); // a directory where a file is expected: readFile throws EISDIR
    mocks.exec.mockImplementation(execSucceeds(''));

    const { workers, error } = await collectWorkerStats();

    expect(workers).toEqual([]);
    expect(error).toContain('EISDIR');
    expect(error).toContain(configPath);
  });
});

/**
 * Why the fault counts as much as the rows: a collector that threw and a fleet that is genuinely
 * worker-less both come back as an empty list, and only the fault tells the panel which it was.
 */
describe('collectWorkerStats named faults', () => {
  it('names a thrown collector read instead of reporting an empty fleet', async () => {
    mocks.groupBy.mockRejectedValue(new Error('database unreachable'));

    const { workers, error } = await collectWorkerStats();

    expect(workers).toEqual([]);
    expect(error).toContain('database unreachable');
  });

  it('names a failed docker read instead of reporting an empty fleet', async () => {
    mocks.exec.mockImplementation((_command: string, callback: ExecCallback): void => {
      callback(new Error('Cannot connect to the Docker daemon'), { stdout: '', stderr: '' });
    });

    const { workers, error } = await collectWorkerStats();

    expect(workers).toEqual([]);
    expect(error).toContain('Cannot connect to the Docker daemon');
  });

  it('carries the emitter failure into the fault beside the unreadable configuration', async () => {
    fs.mkdirSync(path.join(repoRoot, 'config.toml')); // a directory where a file is expected: readFile throws EISDIR
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback): void => {
      callback(new Error('EACCES: permission denied'), { stdout: '', stderr: '' });
    });
    mocks.exec.mockImplementation(execSucceeds(''));

    const { error } = await collectWorkerStats();

    expect(error).toContain('the emitter failed');
    expect(error).toContain('EACCES');
    expect(error).toContain('EISDIR');
  });
});
