import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  runConfigSync: vi.fn(),
  recordAudit: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/deploy-config', () => ({ runConfigSync: mocks.runConfigSync }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/service-wiring-cli', () => ({ renderRegistryArtifacts: vi.fn() }));
vi.mock('child_process', () => ({ exec: mocks.exec }));
vi.mock('@/lib/panel-actions', () => ({
  saveService: vi.fn(),
  removeService: vi.fn(),
  saveWiring: vi.fn(),
  removeWiring: vi.fn(),
  saveExposure: vi.fn(),
  removeExposure: vi.fn(),
}));
vi.mock('@/lib/service-wiring-store', () => ({ readRegistry: vi.fn() }));

import { resyncRegistryAction } from '@/app/actions/serviceWiring';
import { FRONT_RELOAD_COMMAND } from '@/lib/restart-service-scope';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.runConfigSync.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  // child_process.exec is promisified at module load, so the mock answers in the callback shape.
  mocks.exec.mockImplementation((_command: string, _options: unknown, callback: (error: unknown, result: unknown) => void) => {
    callback(null, { stdout: '', stderr: '' });
  });
});

describe('resyncRegistryAction', () => {
  it('re-renders the artifacts and then reloads the front that serves them', async () => {
    expect(await resyncRegistryAction()).toEqual({ success: true });

    expect(mocks.runConfigSync).toHaveBeenCalledTimes(1);
    // promisify appends its own callback, so the command and options are asserted by position.
    const [command, options] = mocks.exec.mock.calls[0];
    expect(command).toBe(FRONT_RELOAD_COMMAND);
    expect(options).toEqual(expect.objectContaining({ cwd: expect.any(String) }));
    // The order is the whole point: the front may only reload a config that is already on disk.
    expect(mocks.runConfigSync.mock.invocationCallOrder[0]).toBeLessThan(mocks.exec.mock.invocationCallOrder[0]);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'service-wiring:resync', result: 'success' }),
    );
  });

  it('reports a failed sync, audits it, and does not reload the front', async () => {
    mocks.runConfigSync.mockRejectedValue(new Error('sync blew up'));
    expect(await resyncRegistryAction()).toEqual({ success: false, error: 'sync blew up' });
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'service-wiring:resync', result: 'failure' }),
    );
  });

  it('refuses before running the sync when the permission is missing', async () => {
    mocks.ensurePermission.mockRejectedValue(new Error('nope'));
    expect(await resyncRegistryAction()).toEqual({ success: false, error: 'nope' });
    expect(mocks.runConfigSync).not.toHaveBeenCalled();
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
