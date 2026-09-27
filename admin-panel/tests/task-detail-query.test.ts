import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, requirePermission, queryRaw } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requirePermission: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { tasks: { findUnique }, $queryRaw: queryRaw } }));
vi.mock('@/lib/server/authorization', () => ({ requirePermission }));
vi.mock('@/lib/field-permissions', () => ({ filterReadableFields: (_entity: string, row: Record<string, unknown>) => row }));

import { getTaskDetailSummary, getTaskOverview, getTaskSettings } from '@/lib/queries/task-detail';

describe('task detail read models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue(new Set(['task:read', 'statement:read']));
    findUnique.mockResolvedValue({
      id: 9,
      name: 'task-nine',
      title: 'Task Nine',
      contests: { id: 3, name: 'Private Contest' },
      score_precision: 0,
      score_mode: 'max',
      feedback_level: 'restricted',
      _count: { submissions: 4 },
    });
  });

  it('does not expose a contest relation to a task reader without contest:read', async () => {
    const result = await getTaskDetailSummary(9);
    expect(result?.contest).toBeNull();
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('datasets_datasets_task_idTotasks');
  });

  it('does not query or return datasets from the overview read', async () => {
    const result = await getTaskOverview(9);
    expect(result?.task).toMatchObject({ id: 9, submissions: 4 });
    expect(result).not.toHaveProperty('datasets');
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty('datasets_datasets_task_idTotasks');
  });

  it('rejects the overview reader without statement:read before querying', async () => {
    requirePermission.mockImplementation(async (permission: string) => {
      if (permission === 'statement:read') {
        throw Object.assign(new Error('Forbidden'), { status: 403, permission });
      }
      return new Set(['task:read']);
    });

    await expect(getTaskOverview(9)).rejects.toMatchObject({
      status: 403,
      permission: 'statement:read',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

const SETTINGS_ROW = {
  id: 9,
  name: 'task-nine',
  title: 'Task Nine',
  score_mode: 'max',
  feedback_level: 'restricted',
  score_precision: 0,
  allowed_languages: [],
  submission_format: [],
  token_mode: 'disabled',
  token_max_number: null,
  token_gen_initial: 2,
  token_gen_number: 2,
  token_gen_max: null,
  max_submission_number: null,
  max_user_test_number: null,
};

describe('task settings read model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue(new Set(['task:read']));
    findUnique.mockResolvedValue(SETTINGS_ROW);
  });

  it('carries real interval values when the interval read succeeds', async () => {
    queryRaw.mockResolvedValue([{ token_min_interval: '00:01:00', token_gen_interval: '00:30:00', min_submission_interval: null, min_user_test_interval: null }]);

    const data = await getTaskSettings(9);

    expect(data?.task).toMatchObject({ id: 9, token_min_interval: '00:01:00', token_gen_interval: '00:30:00' });
  });

  it('degrades a failed interval read to null intervals instead of failing the read', async () => {
    // Why this case: the interval columns live outside the Prisma model, so their
    // read is raw SQL over a CMS-created table. Any failure there must not take
    // down the four cosmetic fields the rest of the settings form still needs.
    queryRaw.mockRejectedValue(new Error('column "token_min_interval" does not exist'));

    const data = await getTaskSettings(9);

    expect(data?.task).toMatchObject({
      id: 9,
      name: 'task-nine',
      title: 'Task Nine',
      token_min_interval: null,
      token_gen_interval: null,
      min_submission_interval: null,
      min_user_test_interval: null,
    });
  });

  it('still reports a missing task as null when the interval read fails', async () => {
    findUnique.mockResolvedValue(null);
    queryRaw.mockRejectedValue(new Error('connection reset'));

    expect(await getTaskSettings(404)).toBeNull();
  });
});
