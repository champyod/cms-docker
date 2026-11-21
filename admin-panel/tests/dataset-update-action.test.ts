import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  datasetUpdate: vi.fn(),
  datasetFindUnique: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    datasets: {
      update: mocks.datasetUpdate,
      findUnique: mocks.datasetFindUnique,
    },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => {}),
  getPermissions: vi.fn(async () => new Set(['dataset:read', 'dataset:update'])),
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));

import { updateDataset } from '@/app/actions/datasets';

const STORED_BATCH_PARAMS: unknown[] = ['grader', ['in.txt', 'out.txt'], 'comparator'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.datasetUpdate.mockResolvedValue({ id: 7 });
  mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: STORED_BATCH_PARAMS });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('updateDataset task type parameters', () => {
  it('stores a parameter list sent with an edit, validated against the stored type', async () => {
    const params = ['alone', ['in.txt', 'out.txt'], 'diff'];
    const result = await updateDataset(7, { task_type_parameters: params });
    expect(result).toEqual({ success: true });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { task_type_parameters: params },
    });
  });

  it('does not touch the stored parameters on a plain field edit', async () => {
    const result = await updateDataset(7, { time_limit: 5 });
    expect(result).toEqual({ success: true });
    expect(mocks.datasetFindUnique).not.toHaveBeenCalled();
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { time_limit: 5 } });
  });

  it('keeps the stored list when a type change leaves it valid for that type', async () => {
    const result = await updateDataset(7, { task_type: 'Batch' });
    expect(result).toEqual({ success: true });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { task_type: 'Batch' } });
  });

  it('rejects a type change the stored list cannot satisfy, without touching the database', async () => {
    const result = await updateDataset(7, { task_type: 'OutputOnly' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Task type "OutputOnly" expects 1 parameter, received 3.');
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });

  it('writes the defaults of the new task type when the dataset stored none', async () => {
    mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: [] });
    const result = await updateDataset(7, { task_type: 'Communication' });
    expect(result).toEqual({ success: true });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { task_type: 'Communication', task_type_parameters: [1, 'alone', 'std_io'] },
    });
  });

  it('rejects a malformed list sent alongside the type, without touching the database', async () => {
    const result = await updateDataset(7, { task_type: 'Batch', task_type_parameters: ['alone', 'diff'] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Task type "Batch" expects 3 parameters, received 2.');
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });
});

describe('updateDataset score type parameters', () => {
  it('carries the score parameters through with the score type', async () => {
    const result = await updateDataset(7, { score_type: 'Sum', score_type_parameters: 0 });
    expect(result).toEqual({ success: true });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { score_type: 'Sum', score_type_parameters: 0 },
    });
  });

  it('rejects a value that is neither a number nor a list', async () => {
    const result = await updateDataset(7, { score_type_parameters: 'zero' });
    expect(result).toEqual({ success: false, error: 'Score parameters must be a number or an array' });
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });
});
