import { beforeEach, describe, expect, it, vi } from 'vitest';

import { controlContainer } from '@/app/actions/docker';
import { updateContainerConfig } from '@/app/actions/containerConfig';
import {
  PROTECTED_CONTAINER_ERROR,
  PROTECTED_CONTAINER_NAMES,
  isProtectedContainerName,
} from '@/lib/protected-containers';

/**
 * The security boundary of the container page.
 *
 * Why these mocks: the guard must be asserted at the point it refuses, so `docker` is intercepted
 * (nothing may reach a real daemon) and the two side effects under assertion — the permission read
 * and the audit row — are stubbed. `server-only` is a bundler marker no test can resolve.
 */
const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mocks.exec };
});

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

/** Answers each shelled-out command the way the real `docker` would for this case. */
function mockDocker(handler: (command: string) => { stdout: string; stderr?: string } | Error): void {
  mocks.exec.mockImplementation((command: string, callback: ExecCallback) => {
    const outcome = handler(command);
    if (outcome instanceof Error) callback(outcome);
    else callback(null, { stdout: outcome.stdout, stderr: outcome.stderr ?? '' });
  });
}

function isInspect(command: string): boolean {
  return command.includes('inspect');
}

describe('isProtectedContainerName', () => {
  it('matches every protected container, with or without the slash inspect prints', () => {
    for (const name of PROTECTED_CONTAINER_NAMES) {
      expect(isProtectedContainerName(name)).toBe(true);
      expect(isProtectedContainerName(`/${name}`)).toBe(true);
    }
  });

  it('leaves the CMS containers and name look-alikes alone', () => {
    expect(isProtectedContainerName('cms-database')).toBe(false);
    // Why: both compose projects declare a service named nginx-proxy, so the contest front
    // (cms-nginx-contest) must stay controllable while grader-nginx-proxy does not.
    expect(isProtectedContainerName('cms-nginx-contest')).toBe(false);
    expect(isProtectedContainerName('grader-waf-extra')).toBe(false);
    expect(isProtectedContainerName('not-grader-waf')).toBe(false);
  });
});

describe('controlContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a protected container and records the refusal', async () => {
    mockDocker((command) => (isInspect(command) ? { stdout: '/grader-waf\n' } : { stdout: '' }));

    const result = await controlContainer('grader-waf', 'stop');

    expect(result).toEqual({ success: false, error: PROTECTED_CONTAINER_ERROR });
    // Why exactly one call: the inspect is the only docker call — no stop was ever issued.
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.exec.mock.calls[0][0]).toContain('inspect');
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'container:control',
      entityId: 'grader-waf',
      result: 'failure',
    }));
  });

  it('still controls an ordinary cms container', async () => {
    mockDocker((command) => (isInspect(command) ? { stdout: '/cms-database\n' } : { stdout: 'cms-database' }));

    const result = await controlContainer('cms-database', 'stop');

    expect(result).toEqual({ success: true });
    expect(mocks.exec).toHaveBeenCalledTimes(2);
    expect(mocks.exec.mock.calls[1][0]).toBe('docker stop cms-database');
  });

  it('fails closed when the container cannot be identified', async () => {
    mockDocker(() => new Error('No such container'));

    const result = await controlContainer('grader-waf', 'stop');

    expect(result.success).toBe(false);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});

describe('updateContainerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to re-policy a protected container before it reads the config file', async () => {
    mockDocker(() => ({ stdout: '/grader-certbot\n' }));

    const result = await updateContainerConfig('grader-certbot', { autoRestart: true });

    expect(result).toEqual({ success: false, error: PROTECTED_CONTAINER_ERROR });
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'container:update',
      entity: 'container_config',
      result: 'failure',
    }));
  });
});
