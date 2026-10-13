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

const CONFIGURED_WORKERS_ENV = 'WORKER_0=cms-worker-0:26000\nWORKER_1=cms-worker-1:26001\n';
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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-worker-stats-'));
  fs.writeFileSync(path.join(repoRoot, '.env'), CONFIGURED_WORKERS_ENV);
  mocks.repoRoot = repoRoot;
  mocks.exec.mockReset();
  mocks.execFile.mockReset();
  mocks.groupBy.mockReset();
  mocks.groupBy.mockResolvedValue([]);
  mocks.exec.mockImplementation(execSucceeds(DOCKER_PS));
  mocks.execFile.mockImplementation(execFileSucceeds('[]'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

/**
 * Why the fallback is asserted through docker's answer: an emitter that returns `[]` has not said the
 * fleet is empty, so the only honest alternatives are the docker-derived list or a named failure.
 */
describe('collectWorkerStats with a degraded emitter', () => {
  it('reads the fleet from docker when the emitter reports no workers', async () => {
    const nodes = await collectWorkerStats();

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(nodes.map((node) => node.id)).toEqual(['worker-0', 'worker-1']);
    expect(nodes[0].connection).toBe('connected');
    expect(nodes[1].connection).toBe('disconnected');
  });

  it('still falls back when the emitter cannot run at all', async () => {
    mocks.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback): void => {
      callback(new Error('EACCES: permission denied'), { stdout: '', stderr: '' });
    });

    const nodes = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-0', 'worker-1']);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it('uses the emitter fleet, and docker not at all, when the emitter reports one', async () => {
    mocks.execFile.mockImplementation(execFileSucceeds(JSON.stringify([
      { shard: 7, endpoint: 'cms-worker-7:26007', state: 'running', reachable: true },
    ])));

    const nodes = await collectWorkerStats();

    expect(nodes.map((node) => node.id)).toEqual(['worker-7']);
    expect(nodes[0].connection).toBe('connected');
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
