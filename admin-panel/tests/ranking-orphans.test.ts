import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadShownContestIds: vi.fn(),
}));

vi.mock('@/lib/ranking-config-store', () => ({ loadShownContestIds: mocks.loadShownContestIds }));

import { readOrphanContestIds } from '@/lib/ranking-orphans';

function override(contestId: number) {
  return { contestId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadShownContestIds.mockResolvedValue(new Set<number>());
});

describe('readOrphanContestIds', () => {
  it('asks the config what the board shows', async () => {
    mocks.loadShownContestIds.mockResolvedValue(new Set([9]));

    await readOrphanContestIds([override(9)]);

    expect(mocks.loadShownContestIds).toHaveBeenCalledOnce();
  });

  it('is silent about a row filed under a shown contest', async () => {
    mocks.loadShownContestIds.mockResolvedValue(new Set([9]));

    expect(await readOrphanContestIds([override(9)])).toEqual(new Set());
  });

  it('names the row filed under a contest the board does not show', async () => {
    mocks.loadShownContestIds.mockResolvedValue(new Set([9]));

    expect(await readOrphanContestIds([override(9), override(3)])).toEqual(new Set([3]));
  });

  it('names every row when the board shows nothing', async () => {
    expect(await readOrphanContestIds([override(3), override(7)])).toEqual(new Set([3, 7]));
  });

  it('does not call a contest served because a binding names it', async () => {
    // The defect this replaces: a bound contest the operator took off the board read as served,
    // so its rows went unflagged while silently not applying.
    mocks.loadShownContestIds.mockResolvedValue(new Set([7]));

    expect(await readOrphanContestIds([override(7), override(9)])).toEqual(new Set([9]));
  });
});
