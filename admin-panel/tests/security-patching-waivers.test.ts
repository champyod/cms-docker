import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { security_waivers: { create: mocks.create, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

import { createWaiver, endWaiver } from '@/lib/panel-actions';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const ACTOR = 7;

describe('security waiver write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 41 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('records a waiver with a future review date and one audit row', async () => {
    const result = await createWaiver(
      ACTOR,
      { source: 'rootfs', match: 'CVE-2026-1', reason: 'vendor backport pending', reviewBy: '2026-12-01' },
      NOW,
    );

    expect(result).toEqual({ success: true, id: 41 });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        source: 'rootfs',
        match: 'CVE-2026-1',
        reason: 'vendor backport pending',
        review_by: new Date('2026-12-01'),
        created_by: ACTOR,
      },
      select: { id: true },
    });
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR,
        verb: 'security.waiver.create',
        entity: 'security_waiver',
        entityId: '41',
        result: 'success',
      }),
    );
  });

  it('refuses a missing, unparseable or past review date', async () => {
    const base = { source: 'osv', match: 'GHSA-xxxx', reason: 'accepted' };
    const missing = await createWaiver(ACTOR, { ...base, reviewBy: '' }, NOW);
    const garbage = await createWaiver(ACTOR, { ...base, reviewBy: 'not-a-date' }, NOW);
    const past = await createWaiver(ACTOR, { ...base, reviewBy: '2026-01-01' }, NOW);

    expect([missing.success, garbage.success, past.success]).toEqual([false, false, false]);
    expect(past.error).toContain('future');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown source, an empty match and an empty reason', async () => {
    const badSource = await createWaiver(ACTOR, { source: 'renovate', match: 'x', reason: 'y', reviewBy: '2026-12-01' }, NOW);
    const badMatch = await createWaiver(ACTOR, { source: 'diun', match: '  ', reason: 'y', reviewBy: '2026-12-01' }, NOW);
    const badReason = await createWaiver(ACTOR, { source: 'diun', match: 'x', reason: '  ', reviewBy: '2026-12-01' }, NOW);

    expect([badSource.success, badMatch.success, badReason.success]).toEqual([false, false, false]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('ends a live waiver and audits the decision', async () => {
    const result = await endWaiver(ACTOR, 41, 'patched in the base image', NOW);

    expect(result).toEqual({ success: true, id: 41 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 41, ended_at: null },
      data: { ended_at: NOW },
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR,
        verb: 'security.waiver.end',
        entityId: '41',
        reason: 'patched in the base image',
      }),
    );
  });

  it('refuses to end a waiver that is missing or already ended, without an audit row', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const result = await endWaiver(ACTOR, 41, 'done', NOW);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or already ended');
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
