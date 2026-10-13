import { beforeEach, describe, expect, it, vi } from 'vitest';

// WHY the prisma mock: the active contest now lives in the database (contests.is_active),
// not in config.toml, so what is asserted here is which row the module reads and the single
// statement it writes — the file round-trip this test used to pin is gone with the helpers.
const { findFirst, executeRaw } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contests: { findFirst },
    $executeRaw: executeRaw,
  },
}));

import { readActiveContestId, writeActiveContestId } from '@/lib/active-contest';

describe('active contest in the database', () => {
  beforeEach(() => {
    findFirst.mockReset();
    executeRaw.mockReset();
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

  it('flags the id active in one statement', async () => {
    executeRaw.mockResolvedValue(2);
    await writeActiveContestId(4);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0][1]).toBe(4);
  });

  it('refuses an id that matches no contest row', async () => {
    // Why: an UPDATE that matched nothing means the id does not exist; clearing every row would
    // leave the stack with no active contest, so the write must fail instead.
    executeRaw.mockResolvedValue(0);
    await expect(writeActiveContestId(99)).rejects.toThrow(/99/);
  });
});
