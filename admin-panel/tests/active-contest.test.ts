import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the prisma mock: the active contest now lives in the database (contests.is_active),
// not in config.toml, so what is asserted here is which row the module reads and the two
// statements it writes — the file round-trip this test used to pin is gone with the helpers.
const { findFirst, executeRaw, transaction } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contests: { findFirst },
    $executeRaw: executeRaw,
    $transaction: transaction,
  },
}));

import { readActiveContestId, writeActiveContestId } from '@/lib/active-contest';

describe('active contest in the database', () => {
  beforeEach(() => {
    findFirst.mockReset();
    executeRaw.mockReset();
    transaction.mockReset();
  });

  it('reads the id of the row flagged active', async () => {
    findFirst.mockResolvedValue({ id: 7 });
    await expect(readActiveContestId()).resolves.toBe(7);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { is_active: true } }));
  });

  it('returns null when no row is active', async () => {
    findFirst.mockResolvedValue(null);
    await expect(readActiveContestId()).resolves.toBeNull();
  });

  it('clears the other rows, then flags the id, in one transaction', async () => {
    transaction.mockResolvedValue([1, 1]);
    await writeActiveContestId(4);
    expect(transaction).toHaveBeenCalledTimes(1);
    const statements = executeRaw.mock.calls.map((call) => String(call[0]));
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('is_active = false');
    expect(statements[1]).toContain('is_active = true');
    expect(executeRaw.mock.calls[0].slice(1)).toEqual([4, 4]);
    expect(executeRaw.mock.calls[1][1]).toBe(4);
  });

  it('refuses an id that matches no contest row', async () => {
    // Why: a target UPDATE that matched nothing means the id does not exist; clearing every row
    // would leave the stack with no active contest, so the write must fail instead.
    transaction.mockResolvedValue([0, 0]);
    await expect(writeActiveContestId(99)).rejects.toThrow(/99/);
  });
});
