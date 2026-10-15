import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  ensurePermission: vi.fn(),
  recordAudit: vi.fn(),
  revalidatePath: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { ranking_overrides: { create: mocks.create } } }));
vi.mock('@/lib/permissions', () => ({ ensurePermission: mocks.ensurePermission }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));

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
