import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getContestRoster: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contest_teams: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      create: mocks.create,
      delete: mocks.delete,
    },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/queries/contest-detail', () => ({ getContestRoster: mocks.getContestRoster }));

import {
  addTeamToRoster,
  listContestRoster,
  removeTeamFromRoster,
  setContestTeamRegisterable,
} from '@/app/actions/contestTeams';

const ROW_KEY = { contest_id: 7, team_id: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
  mocks.create.mockResolvedValue({});
  mocks.delete.mockResolvedValue({});
});

describe('contest roster writes', () => {
  it('gates every write on the team:update key', async () => {
    await setContestTeamRegisterable(7, 3, false);

    expect(mocks.ensurePermission).toHaveBeenCalledWith('team:update');
  });

  it('sets the per-contest value and audits it over the team entity', async () => {
    mocks.findUnique.mockResolvedValue({ contest_id: 7, team_id: 3, registerable: true });

    const result = await setContestTeamRegisterable(7, 3, false);

    expect(result).toEqual({ success: true });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { contest_id_team_id: ROW_KEY },
      create: { ...ROW_KEY, registerable: false },
      update: { registerable: false },
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'team:update',
      entity: 'team',
      entityId: '3',
      beforeValues: { contest_id: 7, team_id: 3, registerable: true },
      afterValues: { ...ROW_KEY, registerable: false },
      result: 'success',
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/[locale]/contests/[id]/participants', 'page');
  });

  it('adds a team to the roster as registerable and audits the new row', async () => {
    const result = await addTeamToRoster(7, 3);

    expect(result).toEqual({ success: true });
    expect(mocks.create).toHaveBeenCalledWith({ data: { ...ROW_KEY, registerable: true } });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'team:update',
      entity: 'team',
      entityId: '3',
      afterValues: { ...ROW_KEY, registerable: true },
      result: 'success',
    }));
  });

  it('removes a team row, returning the team to its own flag', async () => {
    mocks.findUnique.mockResolvedValue({ contest_id: 7, team_id: 3, registerable: false });

    const result = await removeTeamFromRoster(7, 3);

    expect(result).toEqual({ success: true });
    expect(mocks.delete).toHaveBeenCalledWith({ where: { contest_id_team_id: ROW_KEY } });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'team:update',
      entity: 'team',
      entityId: '3',
      beforeValues: { contest_id: 7, team_id: 3, registerable: false },
      afterValues: { contest_id: 7, team_id: null },
      result: 'success',
    }));
  });

  it('refuses a caller without the permission before any write', async () => {
    mocks.ensurePermission.mockRejectedValueOnce(new Error('Unauthorized: Missing team:update permission'));

    await expect(setContestTeamRegisterable(7, 3, true)).rejects.toThrow('Unauthorized');

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('reports a failed write instead of auditing it', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('connection reset'));

    const result = await setContestTeamRegisterable(7, 3, true);

    expect(result).toEqual({ success: false, error: 'connection reset' });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('lists the roster through the contest read model', async () => {
    const rows = [{ teamId: 3, code: 'AAA', name: 'Team A', teamDefault: true, registerable: true, state: 'inherited' }];
    mocks.getContestRoster.mockResolvedValue({ contestId: 7, roster: rows, permissionKeys: ['contest:read', 'team:read'] });

    expect(await listContestRoster(7)).toEqual(rows);
    expect(mocks.getContestRoster).toHaveBeenCalledWith(7);
  });

  it('lists no rows for a contest the reader does not know', async () => {
    mocks.getContestRoster.mockResolvedValue(null);

    expect(await listContestRoster(404)).toEqual([]);
  });
});
