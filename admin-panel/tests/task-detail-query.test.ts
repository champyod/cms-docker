import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, requirePermission } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { tasks: { findUnique } } }));
vi.mock('@/lib/server/authorization', () => ({ requirePermission }));
vi.mock('@/lib/field-permissions', () => ({ filterReadableFields: (_entity: string, row: Record<string, unknown>) => row }));

import { getTaskDetailSummary, getTaskOverview } from '@/lib/queries/task-detail';

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
