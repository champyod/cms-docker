import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findings: vi.fn(),
  waivers: vi.fn(),
  admins: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    security_findings: { findMany: mocks.findings },
    security_waivers: { findMany: mocks.waivers },
    admins: { findMany: mocks.admins },
  },
}));

import { readPatchingSnapshot, readWaiverExport } from '@/lib/security/patching-read';

const NOW = new Date('2026-10-25T00:00:00.000Z');
const LAPSED = new Date('2026-10-01T00:00:00.000Z');
const SOON = new Date('2027-01-31T00:00:00.000Z');

function waiverRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    source: 'rootfs',
    match: 'CVE-2026-1',
    reason: 'vendor backport pending',
    review_by: SOON,
    created_by: 1,
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    ended_at: null,
    ...overrides,
  };
}

describe('the expired-waiver read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findings.mockResolvedValue([]);
    mocks.admins.mockResolvedValue([{ id: 1, username: 'root' }]);
  });

  it('flags a lapsed waiver, names its signer and counts it on the card', async () => {
    mocks.waivers.mockResolvedValue([
      waiverRow({ id: 1, review_by: LAPSED }),
      waiverRow({ id: 2, match: 'CVE-2026-2' }),
    ]);

    const state = await readPatchingSnapshot(NOW);

    expect(state.waivers.map((waiver) => waiver.expired)).toEqual([true, false]);
    expect(state.waivers[0].reviewBy).toBe(LAPSED.toISOString());
    expect(state.waivers[0].createdByName).toBe('root');
    expect(state.cards.expiredWaivers).toBe(1);
    // Only live rows are read, so an ended decision cannot appear as an expired one.
    expect(mocks.waivers).toHaveBeenCalledWith({
      where: { ended_at: null },
      orderBy: [{ review_by: 'asc' }],
    });
  });

  it('keeps a waiver whose author no longer exists, with a null name rather than a blank row', async () => {
    mocks.admins.mockResolvedValue([]);
    mocks.waivers.mockResolvedValue([waiverRow({ created_by: 42 })]);

    const state = await readPatchingSnapshot(NOW);

    expect(state.waivers[0].createdByName).toBeNull();
    expect(state.waivers[0].createdBy).toBe(42);
  });

  it('renders the export from the same live rows CI gates on', async () => {
    mocks.waivers.mockResolvedValue([waiverRow({ id: 1 }), waiverRow({ id: 2, source: 'osv', match: 'GHSA-x' })]);

    const exported = await readWaiverExport(NOW);

    expect(exported.version).toBe(1);
    expect(exported.generatedAt).toBe(NOW.toISOString());
    expect(exported.waivers).toEqual([
      {
        id: 1,
        source: 'rootfs',
        match: 'CVE-2026-1',
        reason: 'vendor backport pending',
        reviewBy: SOON.toISOString(),
        createdAt: '2026-09-01T00:00:00.000Z',
        createdBy: 1,
        createdByName: 'root',
        endedAt: null,
      },
      expect.objectContaining({ id: 2, source: 'osv', match: 'GHSA-x' }),
    ]);
  });

  // A row outside the contract's enum can only come from a hand-written INSERT, and the gate
  // refuses those. Refusing the export keeps the file from claiming a family the row is not.
  it('refuses to export a row whose source is outside the contract', async () => {
    mocks.waivers.mockResolvedValue([waiverRow({ source: 'renovate' })]);

    await expect(readWaiverExport(NOW)).rejects.toThrow(/outside the contract enum/);
  });
});
