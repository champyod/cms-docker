import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The action is the place the rule has to hold: the dialog is one caller, while the panel also
 * restarts services from paths that ask nobody anything (a saved environment setting, a monitor
 * recreation). A refusal that lived only in the dialog would leave those paths unrecorded.
 */
describe('restartServices requires and records a justification', () => {
  beforeEach(() => vi.resetModules());

  interface Harness {
    restartServices: (
      type: 'all' | 'core' | 'admin' | 'worker' | 'custom',
      customList: string[] | undefined,
      reason: string,
    ) => Promise<{ success: boolean; error?: string; message?: string }>;
    execMock: ReturnType<typeof vi.fn>;
    auditMock: ReturnType<typeof vi.fn>;
    discordMock: ReturnType<typeof vi.fn>;
  }

  async function load(): Promise<Harness> {
    const execMock = vi.fn((_command: string, _options: unknown, callback: (error: unknown, out: { stdout: string; stderr: string }) => void): void => {
      callback(null, { stdout: 'restarted', stderr: '' });
    });
    const auditMock = vi.fn(async () => {});
    const discordMock = vi.fn(async () => {});

    vi.doMock('child_process', () => ({ exec: execMock }));
    vi.doMock('@/lib/permissions', () => ({ ensurePermission: vi.fn(async () => {}) }));
    vi.doMock('@/lib/audit', () => ({ recordAudit: auditMock }));
    vi.doMock('@/lib/discord-notifier', () => ({ logToDiscord: discordMock }));
    vi.doMock('@/lib/repo-root', () => ({ getRepoRoot: (): string => '/repo' }));
    vi.doMock('@/lib/compose-location', () => ({
      resolveHostComposeLocation: async (): Promise<{ ok: boolean; location: string }> => ({ ok: true, location: '/repo' }),
    }));
    vi.doMock('@/lib/deployment-mode-file', () => ({
      readDeploymentModeSetting: async (): Promise<{ mode: string; resolved: boolean }> => ({ mode: 'img', resolved: true }),
    }));
    vi.doMock('@/lib/restart-planner', () => ({
      buildComposeFileFlags: async (): Promise<string[]> => ['-f', 'docker-compose.yml'],
      buildRestartCommand: async (): Promise<{ skip: boolean; command: string }> => ({ skip: false, command: 'docker compose restart core' }),
      analyzeContainerDependencies: async (): Promise<unknown> => ({ services: [] }),
      getRestartPolicies: (): unknown => ({ policies: [] }),
    }));

    const loaded = await import('@/app/actions/services');
    return { restartServices: loaded.restartServices as Harness['restartServices'], execMock, auditMock, discordMock };
  }

  it('refuses a blank reason before running anything', async () => {
    const { restartServices, execMock, auditMock } = await load();

    const result = await restartServices('core', undefined, '   ');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reason/i);
    // The refusal has to happen before the compose command exists, not after it ran.
    expect(execMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('runs the restart and records the trimmed reason in the audit row', async () => {
    const { restartServices, execMock, auditMock } = await load();

    const result = await restartServices('core', undefined, '  applying the kernel patch  ');

    expect(result.success).toBe(true);
    // Why the command and not a call count: `make env` runs through the same executor, so a count
    // would pin an implementation detail rather than the fact that the restart command ran.
    expect(execMock.mock.calls.map((call) => String(call[0])).join('\n')).toContain('docker compose restart core');
    const row = auditMock.mock.calls.find((call) => (call[0] as { verb?: string }).verb === 'service:restart');
    expect(row).toBeDefined();
    expect((row?.[0] as { afterValues: { reason: string } }).afterValues.reason).toBe('applying the kernel patch');
  });

  it('carries the reason into the operator channel too', async () => {
    const { restartServices, discordMock } = await load();

    await restartServices('all', undefined, 'patching the host kernel');

    const line = discordMock.mock.calls.map((call) => String(call[1])).join('\n');
    expect(line).toContain('patching the host kernel');
  });
});
