import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();
const mockAudit = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordAudit: (...args: unknown[]) => mockAudit(...args) }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => undefined),
  getPermissions: vi.fn(async () => new Set(['submission:read', 'submission:update'])),
}));
vi.mock('@/lib/field-permissions', () => ({
  stripDisallowedFields: (_entity: string, data: Record<string, unknown>) => data,
  getFieldAccess: () => ({}),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { submissions: { findUnique: (...args: unknown[]) => mockFindUnique(...args), updateMany: (...args: unknown[]) => mockUpdateMany(...args) } },
}));

import { revalidatePath } from 'next/cache';
import { setSubmissionOfficial, toggleSubmissionOfficial } from '@/app/actions/submissions';

beforeEach(() => {
  vi.clearAllMocks();
  mockAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('toggleSubmissionOfficial', () => {
  it('writes against the value it read, so the flip is conditional', async () => {
    mockFindUnique.mockResolvedValue({ official: false });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const outcome = await toggleSubmissionOfficial(7);

    expect(outcome.success).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 7, official: false },
      data: { official: true },
    });
  });

  it('reports a stale tab instead of flipping the flag twice', async () => {
    mockFindUnique.mockResolvedValue({ official: false });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const outcome = await toggleSubmissionOfficial(7);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('changed elsewhere');
    expect(mockAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('records an optional reason in the audit row and afterValues', async () => {
    mockFindUnique.mockResolvedValue({ official: true });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const outcome = await toggleSubmissionOfficial(7, '  steward request  ');

    expect(outcome.success).toBe(true);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      verb: 'submission:update',
      entityId: '7',
      reason: 'steward request',
      beforeValues: { official: true },
      afterValues: { official: false, reason: 'steward request' },
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('leaves the reason out of the audit row when none is given', async () => {
    mockFindUnique.mockResolvedValue({ official: false });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    await toggleSubmissionOfficial(7, '   ');

    const entry = mockAudit.mock.calls[0][0];
    expect('reason' in entry).toBe(false);
    expect(entry.afterValues).toEqual({ official: true });
  });

  it('does not write when the submission is gone', async () => {
    mockFindUnique.mockResolvedValue(null);

    const outcome = await toggleSubmissionOfficial(7);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('not found');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe('setSubmissionOfficial', () => {
  function mockSelection(counts: Record<number, number>): void {
    mockUpdateMany.mockImplementation(async ({ where }: { where: { id: number } }) => ({
      count: counts[where.id] ?? 0,
    }));
  }

  it('sets the flag on every row that is not already there and reports the count', async () => {
    mockSelection({ 1: 1, 2: 0, 3: 1 });

    const outcome = await setSubmissionOfficial([1, 2, 3], true, 'audit trail sweep');

    expect(outcome).toEqual({ success: true, updated: 2 });
    expect(mockUpdateMany).toHaveBeenCalledTimes(3);
    for (const call of mockUpdateMany.mock.calls) {
      expect(call[0].where.official).toBe(false);
      expect(call[0].data).toEqual({ official: true });
    }
  });

  it('audits one row per changed submission plus one batch row', async () => {
    mockSelection({ 1: 1, 2: 0 });

    await setSubmissionOfficial([1, 2], false, 'reason given');

    const entries = mockAudit.mock.calls.map(([entry]) => entry);
    const perIdRows = entries.filter((entry) => entry.entityId === '1' || entry.entityId === '2');
    const batchRows = entries.filter((entry) => entry.entityId === 'ids=1,2');
    expect(perIdRows).toHaveLength(1);
    expect(perIdRows[0]).toMatchObject({
      beforeValues: { official: true },
      afterValues: { official: false, reason: 'reason given' },
      reason: 'reason given',
    });
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0].afterValues).toEqual({ official: false, requested: 2, updated: 1 });
    expect(batchRows[0].reason).toBe('reason given');
  });

  it('revalidates the submission surfaces only when something changed', async () => {
    mockSelection({ 1: 1 });
    await setSubmissionOfficial([1], true);
    expect(revalidatePath).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
    mockSelection({ 1: 0, 2: 0 });
    const outcome = await setSubmissionOfficial([1, 2], true);
    expect(outcome).toEqual({ success: true, updated: 0 });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('treats an empty selection as a no-op', async () => {
    const outcome = await setSubmissionOfficial([], true);
    expect(outcome).toEqual({ success: true, updated: 0 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
