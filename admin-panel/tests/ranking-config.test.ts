import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the prisma mock: what these assert is which rows the config surface writes and that the
// config row and the projection row travel in one transaction, so the write is observed rather
// than exercised against a database.
const {
  configFindMany,
  configCreate,
  configUpdateMany,
  contestFindUnique,
  adminsFindMany,
  executeRaw,
  transaction,
  ensurePermission,
  recordAudit,
  revalidatePath,
} = vi.hoisted(() => ({
  configFindMany: vi.fn(),
  configCreate: vi.fn(),
  configUpdateMany: vi.fn(),
  contestFindUnique: vi.fn(),
  adminsFindMany: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_config: { findMany: configFindMany, create: configCreate, updateMany: configUpdateMany },
    contests: { findUnique: contestFindUnique },
    admins: { findMany: adminsFindMany },
    $executeRaw: executeRaw,
    $transaction: transaction,
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: '3' })) }));
vi.mock('next/cache', () => ({ revalidatePath }));

import { endTargets, getShownTargets, showTarget } from '@/app/actions/rankingConfig';
import { CONFIG_TARGETS, SHOWN_KIND, isConfigTarget } from '@/lib/ranking-config';

const CONTEST_ROW = {
  id: 9,
  name: 'POSN Oct 2026 Day 2',
  description: 'Day Two',
  start: new Date('2026-10-16T00:00:00Z'),
  stop: new Date('2026-10-17T00:00:00Z'),
  score_precision: 2,
};

function form(values: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe('the board config vocabulary', () => {
  it('names the target kind the reader understands', () => {
    // The spelling is the contract with the ranking reader's TARGET_CONTEST: a row written under
    // another word is refused at every board route rather than quietly showing nothing.
    expect(SHOWN_KIND).toBe('contest');
    expect(CONFIG_TARGETS).toContain(SHOWN_KIND);
    expect(isConfigTarget(SHOWN_KIND)).toBe(true);
  });

  it('refuses a target kind the reader could not draw', () => {
    expect(isConfigTarget('task')).toBe(false);
    expect(isConfigTarget('')).toBe(false);
  });
});

describe('showing a contest', () => {
  beforeEach(() => {
    configFindMany.mockReset();
    configCreate.mockReset();
    configUpdateMany.mockReset();
    contestFindUnique.mockReset();
    executeRaw.mockReset();
    transaction.mockReset();
    ensurePermission.mockReset();
    recordAudit.mockReset();
    revalidatePath.mockReset();
    contestFindUnique.mockResolvedValue(CONTEST_ROW);
    configCreate.mockReturnValue({ tag: 'config-create' });
    executeRaw.mockReturnValue({ tag: 'raw' });
    transaction.mockImplementation(async (statements: unknown) =>
      Array.isArray(statements) ? statements : [],
    );
  });

  it('writes the config row and the projection row in one transaction', async () => {
    await showTarget(form({ kind: 'contest', targetKey: '9', reason: 'day two goes live' }));

    expect(transaction).toHaveBeenCalledTimes(1);
    const statements = transaction.mock.calls[0][0] as readonly unknown[];
    // Ending the previous row, inserting this one, then the projection row: a board that drew
    // the config row before its contest record existed would show a blank header until the sweep.
    expect(statements).toHaveLength(3);
    expect(statements[0]).toEqual({ tag: 'raw' });
    expect(statements[1]).toEqual({ tag: 'config-create' });
    expect(statements[2]).toEqual({ tag: 'raw' });
    expect(configCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ target_kind: 'contest', target_key: '9' }),
      }),
    );
  });

  it('records who showed it, on the row and in the audit log', async () => {
    await showTarget(form({ kind: 'contest', targetKey: '9', reason: 'day two goes live' }));
    expect(configCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ created_by: 3 }) }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'ranking:config:show', result: 'success' }),
    );
  });

  it('refuses a show with no reason, and writes nothing', async () => {
    await expect(showTarget(form({ kind: 'contest', targetKey: '9', reason: '  ' }))).rejects.toThrow(
      /reason/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a key that is not a contest id', async () => {
    await expect(
      showTarget(form({ kind: 'contest', targetKey: 'day-two', reason: 'because' })),
    ).rejects.toThrow(/contest id/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses a target kind the reader could not draw', async () => {
    await expect(showTarget(form({ kind: 'task', targetKey: '9', reason: 'because' }))).rejects.toThrow(
      /unknown config target/,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('what the board shows', () => {
  beforeEach(() => {
    configFindMany.mockReset();
    configUpdateMany.mockReset();
    adminsFindMany.mockReset();
    adminsFindMany.mockResolvedValue([]);
    transaction.mockReset();
    ensurePermission.mockReset();
    recordAudit.mockReset();
  });

  it('lists the live rows only, so an ended target is off the board', async () => {
    configFindMany.mockResolvedValue([
      {
        id: BigInt(4),
        target_kind: 'contest',
        target_key: '9',
        reason: 'day two',
        created_at: new Date('2026-10-16T01:00:00Z'),
        created_by: 3,
      },
    ]);
    adminsFindMany.mockResolvedValue([{ id: 3, username: 'root' }]);
    await expect(getShownTargets()).resolves.toEqual([
      {
        id: '4',
        kind: 'contest',
        key: '9',
        reason: 'day two',
        createdAt: '2026-10-16T01:00:00.000Z',
        createdBy: 3,
        createdByName: 'root',
      },
    ]);
    expect(configFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('names no author for a row written outside the panel, and looks nobody up for it', async () => {
    configFindMany.mockResolvedValue([
      {
        id: BigInt(5),
        target_kind: 'contest',
        target_key: '7',
        reason: 'filed by the classic admin',
        created_at: new Date('2026-10-16T02:00:00Z'),
        created_by: null,
      },
    ]);
    await expect(getShownTargets()).resolves.toEqual([
      expect.objectContaining({ id: '5', createdBy: null, createdByName: null }),
    ]);
    expect(adminsFindMany).not.toHaveBeenCalled();
  });

  it('ends without deleting, so the author and the reason survive', async () => {
    configUpdateMany.mockResolvedValue({ count: 1 });
    await endTargets(['4'], 'day two is over');
    expect(configUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [BigInt(4)] }, active: true },
        data: expect.objectContaining({ active: false }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'ranking:config:end' }),
    );
  });

  it('refuses an end with no reason', async () => {
    await expect(endTargets(['4'], '   ')).rejects.toThrow(/reason/);
    expect(configUpdateMany).not.toHaveBeenCalled();
  });
});
