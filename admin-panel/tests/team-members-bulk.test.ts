import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  usersFindMany: vi.fn(),
  participationsFindMany: vi.fn(),
  executeRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  recordAudit: vi.fn(),
  resyncRankingUsers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    users: { findMany: mocks.usersFindMany },
    participations: { findMany: mocks.participationsFindMany },
    $executeRaw: mocks.executeRaw,
    $executeRawUnsafe: mocks.executeRawUnsafe,
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => {}),
  getPermissions: vi.fn(async () => new Set(['participation:update'])),
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/ranking-projection', () => ({ resyncRankingUsers: mocks.resyncRankingUsers }));

import { addUsersToTeamByUsername, applyTeamParticipationSettings } from '@/app/actions/team-members';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.resyncRankingUsers.mockResolvedValue(undefined);
});

describe('addUsersToTeamByUsername', () => {
  it('refuses when no usernames are provided', async () => {
    const result = await addUsersToTeamByUsername(3, 5, ['  ', '']);
    expect(result).toEqual({ success: false, error: 'No usernames provided' });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('adds the found users to the team and reports the ones that do not exist', async () => {
    mocks.usersFindMany.mockResolvedValueOnce([
      { id: 1, username: 'ada' },
      { id: 2, username: 'bob' },
    ]);
    mocks.executeRaw.mockResolvedValue(1);

    const result = await addUsersToTeamByUsername(3, 5, ['ada', 'bob', 'ghost']);

    expect(result).toEqual({ success: true, added: 2, missing: ['ghost'] });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    const text = String(mocks.executeRaw.mock.calls[0][0]);
    expect(text).toContain('ON CONFLICT (contest_id, user_id) DO UPDATE');
    expect(mocks.resyncRankingUsers).toHaveBeenCalledWith(5);
  });
});

describe('applyTeamParticipationSettings', () => {
  it('rejects an invalid IP allowlist before writing', async () => {
    const result = await applyTeamParticipationSettings(5, [1], { ip: '999.1.1.1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid IP or CIDR');
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses when no members are selected', async () => {
    const result = await applyTeamParticipationSettings(5, [], { hidden: true });
    expect(result).toEqual({ success: false, error: 'No members selected' });
  });

  it('updates only the provided settings for the member participations', async () => {
    mocks.participationsFindMany.mockResolvedValueOnce([{ id: 10 }, { id: 11 }]);
    mocks.executeRawUnsafe.mockResolvedValue(2);

    const result = await applyTeamParticipationSettings(5, [1, 2], { hidden: true, ip: '10.0.0.0/8' });

    expect(result).toEqual({ success: true, updated: 2 });
    expect(mocks.executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [query, ...params] = mocks.executeRawUnsafe.mock.calls[0];
    expect(String(query)).toContain('hidden = $1');
    expect(String(query)).toContain('ip = ARRAY[$2::cidr]');
    expect(String(query)).toContain('WHERE id = ANY($3::int[])');
    expect(params).toEqual([true, '10.0.0.0/8', [10, 11]]);
    expect(mocks.resyncRankingUsers).toHaveBeenCalledWith(5);
  });
});
