import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  saveExposure: vi.fn(),
  readRegistry: vi.fn(),
  readFrontVhosts: vi.fn(),
  applyExposureArtifacts: vi.fn(),
  discoverFrontContainer: vi.fn(),
  readServedCertificate: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/panel-actions', () => ({ saveExposure: mocks.saveExposure }));
vi.mock('@/lib/service-wiring-store', () => ({ readRegistry: mocks.readRegistry }));
vi.mock('@/lib/front-vhosts', () => ({ readFrontVhosts: mocks.readFrontVhosts }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/exposure-apply', () => ({ applyExposureArtifacts: mocks.applyExposureArtifacts }));
vi.mock('@/lib/front-nginx', () => ({
  discoverFrontContainer: mocks.discoverFrontContainer,
  createFrontRunner: () => ({ testStagedConfig: vi.fn(), reloadFront: vi.fn() }),
  readServedCertificate: mocks.readServedCertificate,
  liveArtifactsDir: () => '/repo/config/generated',
  STAGING_DIR_NAME: '.staging',
}));

import { saveExposureApplyAction } from '@/app/actions/exposureApply';

const INPUT = { service_id: 1, hostname: 'routes.example.com', path: '/', tls: true, tailnet: null };

const REGISTRY = { services: [], wirings: [], exposures: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.saveExposure.mockResolvedValue({ success: true });
  mocks.readRegistry.mockResolvedValue(REGISTRY);
  mocks.readFrontVhosts.mockResolvedValue([]);
  mocks.discoverFrontContainer.mockResolvedValue('grader-nginx-proxy');
  mocks.readServedCertificate.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.applyExposureArtifacts.mockResolvedValue({ kind: 'applied', changed: ['contest-routes.conf'] });
});

describe('saveExposureApplyAction', () => {
  it('writes the row, then renders to staging and asks the front to prove and reload it', async () => {
    const result = await saveExposureApplyAction(INPUT);

    expect(result).toEqual({ success: true, outcome: 'applied', changed: ['contest-routes.conf'] });
    expect(mocks.saveExposure).toHaveBeenCalledWith(INPUT);
    expect(mocks.saveExposure.mock.invocationCallOrder[0]).toBeLessThan(mocks.applyExposureArtifacts.mock.invocationCallOrder[0]);
    expect(mocks.applyExposureArtifacts).toHaveBeenCalledWith(
      REGISTRY,
      expect.objectContaining({ liveDir: '/repo/config/generated', stagingDir: '/repo/config/generated/.staging' }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'service-wiring:exposure-apply', result: 'success', reason: expect.stringContaining('routes.example.com/') }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('reports a refused row as refused by validation and never renders it', async () => {
    mocks.saveExposure.mockResolvedValue({ success: false, error: 'unsafe hostname' });

    const result = await saveExposureApplyAction(INPUT);

    expect(result).toMatchObject({ success: false, outcome: 'refused-validation', error: 'unsafe hostname' });
    expect(mocks.applyExposureArtifacts).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failure', reason: expect.stringContaining('unsafe hostname') }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('reports a config the front rejects as refused by nginx and audits why', async () => {
    mocks.applyExposureArtifacts.mockResolvedValue({ kind: 'refused', stage: 'nginx-test', error: 'nginx: [emerg] bad directive' });

    const result = await saveExposureApplyAction(INPUT);

    expect(result).toMatchObject({ success: false, outcome: 'refused-nginx', error: 'nginx: [emerg] bad directive' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failure', reason: expect.stringContaining('bad directive') }),
    );
  });

  it('treats a failed reload as the front refusing the change', async () => {
    mocks.applyExposureArtifacts.mockResolvedValue({ kind: 'refused', stage: 'reload', error: 'nginx: reload failed' });
    expect(await saveExposureApplyAction(INPUT)).toMatchObject({ outcome: 'refused-nginx' });
  });

  it('refuses before writing when the permission is missing', async () => {
    mocks.ensurePermission.mockRejectedValue(new Error('not permitted'));

    const result = await saveExposureApplyAction(INPUT);

    expect(result).toMatchObject({ success: false, outcome: 'refused', error: 'not permitted' });
    expect(mocks.saveExposure).not.toHaveBeenCalled();
    expect(mocks.applyExposureArtifacts).not.toHaveBeenCalled();
  });

  it('refuses without touching the filesystem when no front container is running', async () => {
    mocks.discoverFrontContainer.mockResolvedValue(null);

    const result = await saveExposureApplyAction(INPUT);

    expect(result).toMatchObject({ success: false, outcome: 'refused-nginx' });
    expect((result as { error: string }).error).toContain('front container');
    expect(mocks.applyExposureArtifacts).not.toHaveBeenCalled();
  });
});
