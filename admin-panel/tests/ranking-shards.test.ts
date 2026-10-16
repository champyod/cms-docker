import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findContests: vi.fn(),
  readBindings: vi.fn(),
  readActiveContestId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { contests: { findMany: mocks.findContests } } }));
vi.mock('@/lib/contest-binding', () => ({ readShardContestBindings: mocks.readBindings }));
vi.mock('@/lib/active-contest', () => ({ readActiveContestId: mocks.readActiveContestId }));

import { readRankingShards, selectShard } from '@/lib/ranking-shards';

function binding(shard: number, contestId: number, role = 'ContestWebServer', id = shard + 1) {
  return { id, name: `${role}-${shard}`, role, shard, contestId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readActiveContestId.mockResolvedValue(null);
  mocks.findContests.mockResolvedValue([]);
});

describe('readRankingShards', () => {
  it('answers one shard per registry shard, with the contest its own rows name', async () => {
    mocks.readBindings.mockResolvedValue([
      binding(0, 9, 'ContestWebServer', 1),
      binding(0, 9, 'ProxyService', 2),
      binding(1, 7, 'ContestWebServer', 3),
    ]);
    mocks.findContests.mockResolvedValue([
      { id: 9, name: 'day2' },
      { id: 7, name: 'day1' },
    ]);

    expect(await readRankingShards()).toEqual([
      { shard: 0, contestId: 9, contestName: 'day2' },
      { shard: 1, contestId: 7, contestName: 'day1' },
    ]);
  });

  it('keeps two roles on one shard as one shard rather than two tabs', async () => {
    mocks.readBindings.mockResolvedValue([
      binding(0, 9, 'ContestWebServer', 1),
      binding(0, 9, 'ProxyService', 2),
    ]);
    mocks.findContests.mockResolvedValue([{ id: 9, name: 'day2' }]);

    expect(await readRankingShards()).toHaveLength(1);
  });

  it('prefers the contest web server row when a shard\'s roles disagree', async () => {
    mocks.readBindings.mockResolvedValue([
      binding(0, 3, 'ProxyService', 1),
      binding(0, 9, 'ContestWebServer', 2),
    ]);
    mocks.findContests.mockResolvedValue([
      { id: 3, name: 'old' },
      { id: 9, name: 'day2' },
    ]);

    expect(await readRankingShards()).toEqual([{ shard: 0, contestId: 9, contestName: 'day2' }]);
  });

  it('orders the shards ascending however the registry answered', async () => {
    mocks.readBindings.mockResolvedValue([binding(2, 5, 'ContestWebServer', 1), binding(0, 9, 'ContestWebServer', 2)]);
    mocks.findContests.mockResolvedValue([
      { id: 5, name: 'third' },
      { id: 9, name: 'day2' },
    ]);

    expect((await readRankingShards()).map((shard) => shard.shard)).toEqual([0, 2]);
  });

  it('falls back to the active contest as one shard when the registry names none', async () => {
    mocks.readBindings.mockResolvedValue([]);
    mocks.readActiveContestId.mockResolvedValue(9);
    mocks.findContests.mockResolvedValue([{ id: 9, name: 'day2' }]);

    expect(await readRankingShards()).toEqual([{ shard: 0, contestId: 9, contestName: 'day2' }]);
  });

  it('answers no shard when the registry is empty and no contest is active', async () => {
    mocks.readBindings.mockResolvedValue([]);

    expect(await readRankingShards()).toEqual([]);
  });

  it('leaves out a shard whose contest row no longer exists', async () => {
    mocks.readBindings.mockResolvedValue([binding(0, 9)]);
    mocks.findContests.mockResolvedValue([]);

    expect(await readRankingShards()).toEqual([]);
  });
});

describe('selectShard', () => {
  const shards = [
    { shard: 0, contestId: 9, contestName: 'day2' },
    { shard: 1, contestId: 7, contestName: 'day1' },
  ];

  it('answers the shard the request named', () => {
    expect(selectShard(shards, '1')?.contestId).toBe(7);
  });

  it('lands a stale or absent parameter on the first shard rather than a blank page', () => {
    expect(selectShard(shards, '4')?.shard).toBe(0);
    expect(selectShard(shards, undefined)?.shard).toBe(0);
  });

  it('answers no shard at all when there are none', () => {
    expect(selectShard([], '0')).toBeNull();
  });
});
