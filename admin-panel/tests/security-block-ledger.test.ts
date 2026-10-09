import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    security_blocks: {
      updateMany: mocks.updateMany,
      create: mocks.create,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      groupBy: mocks.groupBy,
    },
  },
}));

import {
  DEFAULT_BLOCK_LIMIT,
  countActiveByKind,
  endActiveBlocks,
  endBlock,
  expireStaleBlocks,
  isBlockKind,
  isBlockSource,
  listBlocks,
  recordBlock,
} from '@/lib/security/block-ledger';

interface BlockRowFixture {
  id: bigint;
  kind: string;
  source: string;
  ip: string | null;
  subject: string | null;
  detail: unknown;
  started_at: Date;
  expires_at: Date | null;
  active: boolean;
}

function rowFixture(overrides: Partial<BlockRowFixture> = {}): BlockRowFixture {
  return {
    id: BigInt(7),
    kind: 'fail2ban',
    source: 'agent',
    ip: '10.0.0.5',
    subject: 'nginx-http-auth',
    detail: null,
    started_at: new Date('2026-10-09T10:00:00Z'),
    expires_at: null,
    active: true,
    ...overrides,
  };
}

type TransactionRun = (tx: {
  security_blocks: { updateMany: typeof mocks.updateMany; create: typeof mocks.create };
}) => Promise<unknown>;

describe('security block ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (run: TransactionRun) =>
      run({ security_blocks: { updateMany: mocks.updateMany, create: mocks.create } }),
    );
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.create.mockResolvedValue(rowFixture());
  });

  it('closes a still-active row with the same identity before recording a new block', async () => {
    const startedAt = new Date('2026-10-09T11:00:00Z');

    const block = await recordBlock({
      kind: 'fail2ban',
      source: 'agent',
      ip: '10.0.0.5',
      subject: 'nginx-http-auth',
      startedAt,
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { kind: 'fail2ban', ip: '10.0.0.5', subject: 'nginx-http-auth', active: true },
      data: { active: false, ended_at: startedAt },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        kind: 'fail2ban',
        source: 'agent',
        ip: '10.0.0.5',
        subject: 'nginx-http-auth',
        detail: undefined,
        started_at: startedAt,
        expires_at: null,
      },
    });
    expect(block).toEqual({
      id: '7',
      kind: 'fail2ban',
      source: 'agent',
      ip: '10.0.0.5',
      subject: 'nginx-http-auth',
      detail: null,
      startedAt: new Date('2026-10-09T10:00:00Z'),
      expiresAt: null,
      active: true,
    });
  });

  it('records an explicit expiry for a lockout', async () => {
    const expiresAt = new Date('2026-10-09T11:15:00Z');

    await recordBlock({ kind: 'login_lockout', source: 'app', ip: '10.0.0.9', subject: 'admin', expiresAt });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'login_lockout', expires_at: expiresAt }) }),
    );
  });

  it('lists every kind under the default limit when no filter is given', async () => {
    mocks.findMany.mockResolvedValue([]);

    await listBlocks();

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { started_at: 'desc' },
      take: DEFAULT_BLOCK_LIMIT,
    });
  });

  it('narrows the list by kind, active flag and limit', async () => {
    mocks.findMany.mockResolvedValue([]);

    await listBlocks({ kind: 'waf', active: true, limit: 10 });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { kind: 'waf', active: true },
      orderBy: { started_at: 'desc' },
      take: 10,
    });
  });

  it('rejects a non-numeric block id without touching the database', async () => {
    await expect(endBlock('abc', 3)).resolves.toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('returns null when the row was already closed', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(endBlock('7', 3)).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('returns the closed row and records who closed it', async () => {
    const now = new Date('2026-10-09T12:00:00Z');
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(rowFixture({ active: false }));

    const block = await endBlock('7', 42, now);

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: BigInt(7), active: true },
      data: { active: false, ended_at: now, ended_by: 42 },
    });
    expect(block?.active).toBe(false);
  });

  it('closes every active row matching an identity', async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-10-09T12:30:00Z');

    await expect(endActiveBlocks({ kind: 'login_lockout', subject: 'admin' }, 9, now)).resolves.toBe(2);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { kind: 'login_lockout', ip: null, subject: 'admin', active: true },
      data: { active: false, ended_at: now, ended_by: 9 },
    });
  });

  it('expires only active blocks whose expiry has passed', async () => {
    const now = new Date('2026-10-09T13:00:00Z');
    mocks.updateMany.mockResolvedValue({ count: 4 });

    await expect(expireStaleBlocks(now)).resolves.toBe(4);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { active: true, expires_at: { not: null, lte: now } },
      data: { active: false, ended_at: now },
    });
  });

  it('reports a zero count for every kind that has no active block', async () => {
    mocks.groupBy.mockResolvedValue([{ kind: 'waf', _count: { _all: 3 } }]);

    await expect(countActiveByKind()).resolves.toEqual({ waf: 3, fail2ban: 0, login_lockout: 0 });
  });

  it('ignores a kind the registry does not know', async () => {
    mocks.groupBy.mockResolvedValue([{ kind: 'mystery', _count: { _all: 3 } }]);

    await expect(countActiveByKind()).resolves.toEqual({ waf: 0, fail2ban: 0, login_lockout: 0 });
  });

  it('refuses to map a row whose kind is unknown', async () => {
    mocks.findMany.mockResolvedValue([rowFixture({ kind: 'mystery' })]);

    await expect(listBlocks()).rejects.toThrow('Unknown security block kind: mystery');
  });

  it('guards the kind and source unions', () => {
    expect(isBlockKind('waf')).toBe(true);
    expect(isBlockKind('mystery')).toBe(false);
    expect(isBlockSource('agent')).toBe(true);
    expect(isBlockSource('worker')).toBe(false);
  });
});
