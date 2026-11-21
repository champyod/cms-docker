import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  loadActorNames: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({
  ensurePermission: (...args: unknown[]) => mocks.ensurePermission(...args),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { audit_log: { findMany: (...args: unknown[]) => mocks.findMany(...args), count: (...args: unknown[]) => mocks.count(...args) } },
}));
vi.mock('@/lib/admin-names', () => ({ loadActorNames: (...args: unknown[]) => mocks.loadActorNames(...args) }));
vi.mock('@/lib/entity-names', () => ({
  loadEntityNames: vi.fn(async () => new Map()),
  entityNameKey: (entity: string, id: string) => `${entity}:${id}`,
}));
vi.mock('@/lib/audit', () => ({ VIEW_VERB_SUFFIX: ':view' }));
vi.mock('@/lib/audit-sorting', () => ({ auditSortOrderBy: () => ({ timestamp: 'desc' as const }) }));
vi.mock('@/lib/timezone', () => ({
  resolveDisplayZone: () => 'UTC',
  zoneDayRange: () => ({ gte: null, lte: null }),
}));

import { getAuditLog, getSubmissionHistory } from '@/app/actions/audit';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.loadActorNames.mockResolvedValue(new Map());
});

describe('getAuditLog entityId filter', () => {
  it('narrows the where clause to one entity instance', async () => {
    const result = await getAuditLog({ entity: 'submission', entityId: '42' });

    expect(result.success).toBe(true);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.entity).toBe('submission');
    expect(where.entity_id).toBe('42');
  });

  it('leaves entity_id out when no instance is requested', async () => {
    await getAuditLog({ entity: 'submission' });

    const where = mocks.findMany.mock.calls[0][0].where;
    expect('entity_id' in where).toBe(false);
  });

  it('stays behind audit:read and audit:list', async () => {
    mocks.ensurePermission.mockRejectedValue(new Error('audit:list missing'));

    const result = await getAuditLog({ entityId: '42' });

    expect(result.success).toBe(false);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe('getSubmissionHistory', () => {
  function historyRow(): Record<string, unknown> {
    return {
      id: BigInt(9),
      actor_id: 1,
      timestamp: new Date('2025-06-01T10:00:00.000Z'),
      verb: 'submission:update',
      result: 'success',
      reason: 'steward request',
      before_values: { official: false },
      after_values: { official: true },
    };
  }

  it('returns this submission\u2019s rows with actor, reason and value snapshots', async () => {
    mocks.findMany.mockResolvedValue([historyRow()]);
    mocks.loadActorNames.mockResolvedValue(new Map([[1, 'Ada']]));

    const result = await getSubmissionHistory(42);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([
      {
        id: '9',
        actor_id: 1,
        actor_name: 'Ada',
        timestamp: '2025-06-01T10:00:00.000Z',
        verb: 'submission:update',
        result: 'success',
        reason: 'steward request',
        before_values: { official: false },
        after_values: { official: true },
      },
    ]);
  });

  it('queries the submission\u2019s own audit rows, newest first and bounded', async () => {
    await getSubmissionHistory(42);

    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ entity: 'submission', entity_id: '42' });
    expect(args.orderBy).toEqual([{ timestamp: 'desc' }, { id: 'desc' }]);
    expect(args.take).toBe(100);
  });

  it('renders a system actor without a name', async () => {
    mocks.findMany.mockResolvedValue([{ ...historyRow(), actor_id: null }]);

    const result = await getSubmissionHistory(42);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].actor_id).toBeNull();
    expect(result.data[0].actor_name).toBeNull();
  });

  it('contains a permission failure instead of throwing', async () => {
    mocks.ensurePermission.mockRejectedValue(new Error('audit:read missing'));

    const result = await getSubmissionHistory(42);

    expect(result).toEqual({ success: false, error: 'audit:read missing' });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
