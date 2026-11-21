import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  contestsFindMany: vi.fn(),
  contestsFindUnique: vi.fn(),
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
    contests: { findMany: mocks.contestsFindMany, findUnique: mocks.contestsFindUnique },
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

// The composite key the picker writes: the encoded contest, a slash, the encoded task.
const TASK_HIDE = {
  contestId: '1',
  targetKind: 'task',
  targetKey: 'Spring/aplusb',
  action: 'hide',
  reason: 'task withdrawn',
};

const CONTEST_HIDE = {
  contestId: '1',
  targetKind: 'contest',
  targetKey: 'Spring',
  action: 'hide',
  reason: 'contest withdrawn',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensurePermission.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({});
  mocks.contestsFindUnique.mockResolvedValue({ id: 1 });
  mocks.getSession.mockResolvedValue({ userId: '3' });
});

describe('ranking override targets', () => {
  it('files a task hide with a blank payload, the way a user hide is filed', async () => {
    await saveRankingOverride(form(TASK_HIDE));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_kind: 'task',
        target_key: 'Spring/aplusb',
        action: 'hide',
        payload: undefined,
      }),
    });
  });

  it('refuses a verb a task target cannot mean', async () => {
    await expect(
      saveRankingOverride(form({ ...TASK_HIDE, action: 'rename', value: 'Renamed' })),
    ).rejects.toThrow('a task target does not accept the rename action');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('files a contest hide with the key passed through unchanged', async () => {
    await saveRankingOverride(form(CONTEST_HIDE));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_kind: 'contest',
        target_key: 'Spring',
        action: 'hide',
        payload: undefined,
      }),
    });
  });

  it('refuses a verb a contest target cannot mean', async () => {
    await expect(
      saveRankingOverride(form({ ...CONTEST_HIDE, action: 'rename', value: 'Renamed' })),
    ).rejects.toThrow('a contest target does not accept the rename action');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('files the override under the signed-in admin and the contest it is scoped to', async () => {
    await saveRankingOverride(form(TASK_HIDE));

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contest_id: 1, created_by: 3 }),
    });
  });

  it('refuses a scope the ranking cannot serve, and files nothing', async () => {
    // The scope is the contest the board draws: an override naming one the database does not
    // carry never matches, so it is refused rather than filed as a row that quietly does nothing.
    mocks.contestsFindUnique.mockResolvedValue(null);
    await expect(saveRankingOverride(form(TASK_HIDE))).rejects.toThrow(
      'no contest with id 1 to scope this override',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a contest id that is not an id', async () => {
    await expect(saveRankingOverride(form({ ...TASK_HIDE, contestId: 'spring' }))).rejects.toThrow(
      /needs the contest/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('ranking override target options', () => {
  it('keys the contest picker by the encoded contest name and the task picker by the composite key', async () => {
    mocks.contestsFindMany.mockResolvedValue([{ id: 1, name: 'Spring' }]);
    mocks.participationsFindMany.mockResolvedValue([]);
    mocks.contestTasksFindMany.mockResolvedValue([
      { tasks: { id: 5, name: 'A Plus B', title: 'A Plus B', score_precision: 0 } },
    ]);

    const options = await getRankingOverrideOptions();

    expect(options.contestKeys).toEqual([{ key: 'Spring', label: 'Spring' }]);
    expect(options.taskKeys).toEqual([{ key: 'Spring/A_20Plus_20B', label: 'Spring / A Plus B' }]);
  });

  it('emits one task entry per contest when two contests carry the same task name', async () => {
    mocks.contestsFindMany.mockResolvedValue([
      { id: 1, name: 'Spring' },
      { id: 2, name: 'Autumn' },
    ]);
    mocks.participationsFindMany.mockResolvedValue([]);
    mocks.contestTasksFindMany.mockResolvedValue([
      { tasks: { id: 5, name: 'sum', title: 'Sum', score_precision: 0 } },
    ]);

    const options = await getRankingOverrideOptions();

    expect(options.contestKeys).toEqual([
      { key: 'Autumn', label: 'Autumn' },
      { key: 'Spring', label: 'Spring' },
    ]);
    expect(options.taskKeys).toEqual([
      { key: 'Autumn/sum', label: 'Autumn / sum' },
      { key: 'Spring/sum', label: 'Spring / sum' },
    ]);
  });
});
