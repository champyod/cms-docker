import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  runConfigSync: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/deploy-config', () => ({ runConfigSync: mocks.runConfigSync }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/service-wiring-cli', () => ({ renderRegistryArtifacts: vi.fn() }));
vi.mock('@/lib/service-wiring-store', () => ({
  readRegistry: vi.fn(),
  saveService: vi.fn(),
  removeService: vi.fn(),
  saveWiring: vi.fn(),
  removeWiring: vi.fn(),
  saveExposure: vi.fn(),
  removeExposure: vi.fn(),
}));

import { resyncRegistryAction } from '@/app/actions/serviceWiring';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.runConfigSync.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('resyncRegistryAction', () => {
  it('runs the fixed sync command and audits the success', async () => {
    expect(await resyncRegistryAction()).toEqual({ success: true });
    expect(mocks.runConfigSync).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'service-wiring:resync', result: 'success' }),
    );
  });

  it('reports a failed sync and audits the failure', async () => {
    mocks.runConfigSync.mockRejectedValue(new Error('sync blew up'));
    expect(await resyncRegistryAction()).toEqual({ success: false, error: 'sync blew up' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'service-wiring:resync', result: 'failure' }),
    );
  });

  it('refuses before running the sync when the permission is missing', async () => {
    mocks.ensurePermission.mockRejectedValue(new Error('nope'));
    expect(await resyncRegistryAction()).toEqual({ success: false, error: 'nope' });
    expect(mocks.runConfigSync).not.toHaveBeenCalled();
  });
});
