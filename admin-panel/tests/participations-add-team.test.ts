import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  participationsFindMany: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
  resyncRankingUsers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participations: {
      findMany: mocks.participationsFindMany,
    },
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => {}),
  requirePermission: vi.fn(async () => {}),
  getPermissions: vi.fn(async () => new Set(['participation:create'])),
}));
vi.mock('@/lib/server/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/authorization')>();
  return {
    ...actual,
    requirePermission: vi.fn(async () => {}),
  };
});
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/ranking-projection', () => ({ resyncRankingUsers: mocks.resyncRankingUsers }));

import { addTeamToContest } from '@/app/actions/participations';
import { addParticipant } from '@/lib/services/contests';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = { $executeRaw: mocks.executeRaw };
    return callback(tx);
  });
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.resyncRankingUsers.mockResolvedValue(undefined);
});

describe('addTeamToContest transaction and ON CONFLICT handling', () => {
  it('rejects if no users are associated with the team', async () => {
    mocks.participationsFindMany.mockResolvedValueOnce([]); // team members

    const result = await addTeamToContest(1, 10);
    expect(result).toEqual({ success: false, error: 'No users are associated with this team' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects if all team members are already in the contest', async () => {
    mocks.participationsFindMany
      .mockResolvedValueOnce([{ user_id: 101 }, { user_id: 102 }]) // team members
      .mockResolvedValueOnce([{ user_id: 101 }, { user_id: 102 }]); // already in contest

    const result = await addTeamToContest(1, 10);
    expect(result).toEqual({ success: false, error: 'All team members are already in this contest' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('wraps new member inserts in a transaction and includes ON CONFLICT DO UPDATE clause', async () => {
    mocks.participationsFindMany
      .mockResolvedValueOnce([{ user_id: 101 }, { user_id: 102 }]) // team members
      .mockResolvedValueOnce([{ user_id: 101 }]); // user 101 already in contest, user 102 is new

    mocks.executeRaw.mockResolvedValue(1);

    const result = await addTeamToContest(1, 10, { hidden: true, unrestricted: false });
    expect(result).toEqual({ success: true, added: 1 });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const rawCallStrings = mocks.executeRaw.mock.calls[0][0];
    const fullQueryText = Array.isArray(rawCallStrings) ? rawCallStrings.join(' ') : String(rawCallStrings);
    expect(fullQueryText).toContain('INSERT INTO participations');
    expect(fullQueryText).toContain('ON CONFLICT (contest_id, user_id) DO UPDATE');
    expect(fullQueryText).toContain('SET team_id = EXCLUDED.team_id');
    expect(fullQueryText).toContain('hidden = EXCLUDED.hidden');
    expect(fullQueryText).toContain('unrestricted = EXCLUDED.unrestricted');
  });

  it('returns an error if the transaction fails', async () => {
    mocks.participationsFindMany
      .mockResolvedValueOnce([{ user_id: 101 }])
      .mockResolvedValueOnce([]);

    mocks.transaction.mockRejectedValueOnce(new Error('Transaction aborted'));

    const result = await addTeamToContest(1, 10);
    expect(result).toEqual({ success: false, error: 'Transaction aborted' });
  });
});

describe('addParticipant ON CONFLICT handling', () => {
  it('includes ON CONFLICT (contest_id, user_id) DO NOTHING', async () => {
    mocks.executeRaw.mockResolvedValue(1);

    const result = await addParticipant(1, 42);
    expect(result).toEqual({ success: true });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);

    const rawCallStrings = mocks.executeRaw.mock.calls[0][0];
    const fullQueryText = Array.isArray(rawCallStrings) ? rawCallStrings.join(' ') : String(rawCallStrings);
    expect(fullQueryText).toContain('INSERT INTO participations');
    expect(fullQueryText).toContain('ON CONFLICT (contest_id, user_id) DO NOTHING');
  });
});
