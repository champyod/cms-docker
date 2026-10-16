import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findServices: vi.fn(),
  readActiveContestId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { services: { findMany: mocks.findServices } } }));
vi.mock('@/lib/active-contest', () => ({ readActiveContestId: mocks.readActiveContestId }));

import { readBoundContestIds, readOrphanContestIds } from '@/lib/ranking-orphans';

function override(contestId: number) {
  return { contestId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readActiveContestId.mockResolvedValue(null);
  mocks.findServices.mockResolvedValue([]);
});

describe('readBoundContestIds', () => {
  it('reads the enabled rows that name a contest, disabling nothing else', async () => {
    mocks.findServices.mockResolvedValue([{ contest_id: 9 }, { contest_id: 7 }]);

    expect(await readBoundContestIds()).toEqual(new Set([9, 7]));
    expect(mocks.findServices).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true, contest_id: { not: null } } }),
    );
  });

  it('leaves out a row that names no contest, which binds nothing', async () => {
    mocks.findServices.mockResolvedValue([{ contest_id: null }, { contest_id: 9 }]);

    expect(await readBoundContestIds()).toEqual(new Set([9]));
  });
});

describe('readOrphanContestIds', () => {
  it('is silent about a row filed under a contest some binding serves', async () => {
    mocks.findServices.mockResolvedValue([{ contest_id: 9 }]);

    expect(await readOrphanContestIds([override(9)])).toEqual(new Set());
  });

  it('names the row filed under a contest no binding serves', async () => {
    mocks.findServices.mockResolvedValue([{ contest_id: 9 }]);

    expect(await readOrphanContestIds([override(9), override(3)])).toEqual(new Set([3]));
  });

  it('keeps the active contest off the orphan list when the registry names no row', async () => {
    mocks.readActiveContestId.mockResolvedValue(9);

    expect(await readOrphanContestIds([override(9)])).toEqual(new Set());
  });

  it('names every row when the registry names no contest and none is active', async () => {
    expect(await readOrphanContestIds([override(3), override(7)])).toEqual(new Set([3, 7]));
  });
});
