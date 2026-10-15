import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  contestsFindMany: vi.fn(),
  contestTasksFindMany: vi.fn(),
  participationsFindMany: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ranking_overrides: { create: mocks.create },
    contests: { findMany: mocks.contestsFindMany },
    contest_tasks: { findMany: mocks.contestTasksFindMany },
    participations: { findMany: mocks.participationsFindMany },
  },
}));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));

import { getRankingOverrideOptions } from '@/app/actions/ranking';
import { saveRankingOverride } from '@/app/actions/rankingOverrides';

function form(fields: Readonly<Record<string, string>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const TASK_HIDE = {
  contestId: '1',
  targetKind: 'task',
  targetKey: 'aplusb',
  action: 'hide',
  reason: 'task withdrawn',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({});
  mocks.getSession.mockResolvedValue(null);
});

describe('ranking override targets', () => {
  it('files a task hide with a blank payload, the way a user hide is filed', async () => {
    await saveRankingOverride(form(TASK_HIDE));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_kind: 'task',
        target_key: 'aplusb',
        action: 'hide',
        payload: undefined,
      }),
    });
  });

  it('refuses a verb a task target cannot mean', async () => {
    await expect(
      saveRankingOverride(form({ ...TASK_HIDE, action: 'rename', value: 'Renamed' })),
    ).rejects.toThrow('a task target only accepts hide, not rename');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('ranking override target options', () => {
  it('keys the task picker by the encoded name the board keys its column by', async () => {
    mocks.contestsFindMany.mockResolvedValue([{ id: 1, name: 'Spring' }]);
    mocks.participationsFindMany.mockResolvedValue([]);
    mocks.contestTasksFindMany.mockResolvedValue([
      { tasks: { id: 5, name: 'A Plus B', title: 'A Plus B', score_precision: 0 } },
    ]);

    const options = await getRankingOverrideOptions();

    expect(options.taskKeys).toEqual([{ key: 'A_20Plus_20B', label: 'A Plus B' }]);
  });

  it('lists a task once when two contests carry the same task name', async () => {
    mocks.contestsFindMany.mockResolvedValue([
      { id: 1, name: 'Spring' },
      { id: 2, name: 'Autumn' },
    ]);
    mocks.participationsFindMany.mockResolvedValue([]);
    mocks.contestTasksFindMany.mockResolvedValue([
      { tasks: { id: 5, name: 'sum', title: 'Sum', score_precision: 0 } },
    ]);

    const options = await getRankingOverrideOptions();

    expect(options.taskKeys).toEqual([{ key: 'sum', label: 'sum' }]);
  });
});
