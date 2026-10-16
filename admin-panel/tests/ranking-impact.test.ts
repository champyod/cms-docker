import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findContest: vi.fn(),
  findTasks: vi.fn(),
  findUsers: vi.fn(),
  findTeams: vi.fn(),
  findRankingContest: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contests: { findUnique: mocks.findContest },
    ranking_tasks: { findMany: mocks.findTasks },
    ranking_users: { findMany: mocks.findUsers },
    ranking_teams: { findMany: mocks.findTeams },
    ranking_contests: { findUnique: mocks.findRankingContest },
  },
}));

import { readRankingImpact } from '@/lib/ranking-impact';

const SPRING = { name: 'Spring Contest' };
const SPRING_KEY = 'Spring_20Contest';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findContest.mockResolvedValue(SPRING);
  mocks.findTasks.mockResolvedValue([]);
  mocks.findUsers.mockResolvedValue([]);
  mocks.findTeams.mockResolvedValue([]);
  mocks.findRankingContest.mockResolvedValue(null);
});

describe('readRankingImpact', () => {
  it('answers an empty impact while the target is still blank', async () => {
    const impact = await readRankingImpact({ contestId: 1, targetKind: 'user', targetKey: '' });

    expect(impact).toMatchObject({ columns: [], users: [], teams: [], unknownTarget: false });
    expect(mocks.findTasks).not.toHaveBeenCalled();
  });

  it('answers an empty impact when the shard names no contest', async () => {
    const impact = await readRankingImpact({ contestId: null, targetKind: 'user', targetKey: 'ada' });

    expect(impact.users).toEqual([]);
  });

  it('drops the board column a composite task hide names', async () => {
    mocks.findTasks.mockResolvedValue([{ name: 'aplusb' }]);

    const impact = await readRankingImpact({
      contestId: 1,
      targetKind: 'task',
      targetKey: `${SPRING_KEY}/aplusb`,
    });

    expect(impact).toMatchObject({ columns: ['aplusb'], unknownTarget: false, scopeMismatch: false });
    expect(mocks.findTasks).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contest: SPRING_KEY, key: 'aplusb' } }),
    );
  });

  it('flags a task key that names a contest other than the one the shard serves', async () => {
    mocks.findTasks.mockResolvedValue([{ name: 'aplusb' }]);

    const impact = await readRankingImpact({
      contestId: 1,
      targetKind: 'task',
      targetKey: 'Other_20Contest/aplusb',
    });

    expect(impact.scopeMismatch).toBe(true);
  });

  it('reports a bare task key as unknown when the projection holds no such task', async () => {
    const impact = await readRankingImpact({ contestId: 1, targetKind: 'task', targetKey: 'ghost' });

    expect(impact).toMatchObject({ columns: [], unknownTarget: true });
    expect(mocks.findTasks).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'ghost' } }));
  });

  it('drops every column of a hidden contest', async () => {
    mocks.findTasks.mockResolvedValue([{ name: 'aplusb' }, { name: 'bplusc' }]);
    mocks.findRankingContest.mockResolvedValue({ name: 'Spring Contest' });

    const impact = await readRankingImpact({ contestId: 1, targetKind: 'contest', targetKey: SPRING_KEY });

    expect(impact.columns).toEqual(['aplusb', 'bplusc']);
    expect(impact.unknownTarget).toBe(false);
  });

  it('names the board rows a user hide removes, matching the encoded spelling too', async () => {
    mocks.findUsers.mockResolvedValue([{ key: 'preserve_201', f_name: 'Preserve', l_name: 'One' }]);

    const impact = await readRankingImpact({ contestId: 1, targetKind: 'user', targetKey: 'preserve 1' });

    expect(impact.users).toEqual(['Preserve One']);
    expect(mocks.findUsers).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: ['preserve 1', 'preserve_201'] } } }),
    );
  });

  it('reports a user the projection never carried as changing nothing', async () => {
    const impact = await readRankingImpact({ contestId: 1, targetKind: 'user', targetKey: 'ghost' });

    expect(impact).toMatchObject({ users: [], unknownTarget: true });
  });

  it('names a team and the members it takes with it', async () => {
    mocks.findUsers.mockResolvedValue([{ key: 'ada', f_name: 'Ada', l_name: 'Lovelace' }]);
    mocks.findTeams.mockResolvedValue([{ name: 'Alpha' }]);

    const impact = await readRankingImpact({ contestId: 1, targetKind: 'team', targetKey: 'alpha' });

    expect(impact).toMatchObject({ teams: ['Alpha'], users: ['Ada Lovelace'], unknownTarget: false });
  });

  it('reads the whole board for the wildcard target of the contest the shard serves', async () => {
    mocks.findTasks.mockResolvedValue([{ name: 'aplusb' }]);

    const impact = await readRankingImpact({ contestId: 1, targetKind: 'ranking', targetKey: '*' });

    expect(impact.columns).toEqual(['aplusb']);
    expect(mocks.findTasks).toHaveBeenCalledWith(expect.objectContaining({ where: { contest: SPRING_KEY } }));
  });
});
