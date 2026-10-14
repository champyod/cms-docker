import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  executeRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({ statement: 'raw' })),
  transaction: vi.fn(),
  readActiveContestId: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participations: { findMany: mocks.findMany },
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/active-contest', () => ({ readActiveContestId: mocks.readActiveContestId }));

import { encodeId, resyncRankingUsers } from '@/lib/ranking-projection';

function participation(username: string, team: { code: string; name: string } | null): unknown {
  return {
    users: { username, first_name: 'Ada', last_name: 'Lovelace' },
    teams: team,
  };
}

/** The SQL text of every statement the projection built, in the order it built them. */
function statements(): string[] {
  return mocks.executeRaw.mock.calls.map((call) => (call[0] as TemplateStringsArray).join('?'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readActiveContestId.mockResolvedValue(3);
  mocks.transaction.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resyncRankingUsers', () => {
  it('projects every referenced team beside its users', async () => {
    mocks.findMany.mockResolvedValue([
      participation('ada', { code: 'alpha', name: 'Alpha' }),
      participation('bob', { code: 'alpha', name: 'Alpha' }),
      participation('cara', null),
    ]);

    await resyncRankingUsers(3);

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { contest_id: 3, hidden: false },
      select: {
        users: { select: { username: true, first_name: true, last_name: true } },
        teams: { select: { code: true, name: true } },
      },
    });

    const sql = statements();
    // One team row for the two members of Alpha, and one user row per participant.
    expect(sql.filter((statement) => statement.includes('INSERT INTO ranking_teams'))).toHaveLength(1);
    expect(sql.filter((statement) => statement.includes('INSERT INTO ranking_users'))).toHaveLength(3);
    expect(sql.some((statement) => statement.includes('DELETE FROM ranking_users'))).toBe(true);
  });

  it('touches nothing when the edited contest is not the active one', async () => {
    mocks.readActiveContestId.mockResolvedValue(9);

    await resyncRankingUsers(3);

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('encodeId', () => {
  it('mirrors the proxy encoding', () => {
    expect(encodeId('a b')).toBe('a_20b');
  });
});
