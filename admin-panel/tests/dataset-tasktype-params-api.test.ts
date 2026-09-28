import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { validateTaskTypeParams } from '@/lib/tasktype-params';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  datasetCreate: vi.fn(),
  datasetUpdate: vi.fn(),
  datasetFindUnique: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    datasets: {
      create: mocks.datasetCreate,
      update: mocks.datasetUpdate,
      findUnique: mocks.datasetFindUnique,
    },
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  getPermissions: vi.fn(async () => new Set(['dataset:read', 'dataset:update', 'dataset:create'])),
  ensurePermission: vi.fn(async () => {}),
}));

import { POST as createDatasetRoute } from '@/app/api/datasets/route';
import { PUT as updateDatasetRoute } from '@/app/api/datasets/[id]/route';

const VALID_PARAMS: Readonly<Record<string, unknown[]>> = {
  Batch: ['alone', ['', ''], 'diff'],
  OutputOnly: ['diff'],
  TwoSteps: ['comparator'],
  Communication: [1, 'alone', 'std_io'],
};

async function postDataset(body: Record<string, unknown>): Promise<Response> {
  return createDatasetRoute(new NextRequest('http://localhost/api/datasets', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

async function putDataset(body: Record<string, unknown>): Promise<Response> {
  return updateDatasetRoute(
    new NextRequest('http://localhost/api/datasets/7', { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: '7' }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.datasetCreate.mockResolvedValue({ id: 7, memory_limit: null });
  mocks.datasetUpdate.mockResolvedValue({ id: 7 });
  mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: [] });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('create dataset task type parameters', () => {
  it('stores a valid list for every task type the panel offers', async () => {
    for (const [taskType, params] of Object.entries(VALID_PARAMS)) {
      const response = await postDataset({ taskId: 1, description: 'Base', task_type: taskType, task_type_parameters: params });
      expect(response.status).toBe(200);
    }
    expect(mocks.datasetCreate).toHaveBeenCalledTimes(4);
  });

  it('normalizes the empty list of an untouched form to the type defaults', async () => {
    for (const taskType of Object.keys(VALID_PARAMS)) {
      await postDataset({ taskId: 1, description: 'Base', task_type: taskType, task_type_parameters: [] });
    }
    const stored = mocks.datasetCreate.mock.calls.map((call) => call[0].data.task_type_parameters);
    expect(stored).toEqual([
      ['alone', ['', ''], 'diff'],
      ['diff'],
      ['diff'],
      [1, 'alone', 'std_io'],
    ]);
  });

  it('rejects the wrong parameter count for each task type', async () => {
    const response = await postDataset({
      taskId: 1,
      description: 'Base',
      task_type: 'Batch',
      task_type_parameters: ['alone', 'diff'],
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Task type "Batch" expects 3 parameters, received 2');
    expect(body.error).toContain('["alone",["",""],"diff"]');
  });

  it('rejects a choice the task type does not declare', async () => {
    const response = await postDataset({
      taskId: 1,
      description: 'Base',
      task_type: 'Communication',
      task_type_parameters: [1, 'grader', 'std_io'],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Compilation must be one of: alone, stub.');
  });

  it('rejects a process count that is not an integer and a malformed I/O pair', async () => {
    const count = await postDataset({
      taskId: 1, description: 'Base', task_type: 'Communication', task_type_parameters: [1.5, 'alone', 'std_io'],
    });
    expect(count.status).toBe(400);
    expect((await count.json()).error).toBe('Number of processes must be an integer.');

    const io = await postDataset({
      taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: ['alone', ['in.txt'], 'diff'],
    });
    expect(io.status).toBe(400);
    expect((await io.json()).error).toBe('Input file must be a list of 2 values.');
  });

  it('rejects a value that is not a list and an unknown task type', async () => {
    const notAList = await postDataset({ taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: 'diff' });
    expect(notAList.status).toBe(400);
    expect((await notAList.json()).error).toBe('Task type parameters must be an array.');

    const unknown = await postDataset({ taskId: 1, description: 'Base', task_type: 'Interactive', task_type_parameters: ['diff'] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe('Unknown task type "Interactive".');
  });

  it('never reaches the database for a rejected list', async () => {
    await postDataset({ taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: ['stub', ['', ''], 'diff'] });
    expect(mocks.datasetCreate).not.toHaveBeenCalled();
  });
});

describe('update dataset task type parameters', () => {
  it('stores a valid list and passes the type unchanged', async () => {
    const response = await putDataset({ action: 'update', task_type: 'Batch', task_type_parameters: ['grader', ['in.txt', 'out.txt'], 'comparator'] });
    expect(response.status).toBe(200);
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        task_type: 'Batch',
        task_type_parameters: ['grader', ['in.txt', 'out.txt'], 'comparator'],
      },
    });
  });

  it('rejects a bad list without touching the database', async () => {
    const response = await putDataset({ action: 'update', task_type: 'OutputOnly', task_type_parameters: ['diff', 'comparator'] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Task type "OutputOnly" expects 1 parameter, received 2.');
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });

  it('normalizes an empty list against the task type being stored', async () => {
    await putDataset({ action: 'update', task_type: 'TwoSteps', task_type_parameters: [] });
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { task_type: 'TwoSteps', task_type_parameters: ['diff'] },
    });
  });

  it('validates the stored list when only the task type changes', async () => {
    mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: ['grader', ['in.txt', 'out.txt'], 'comparator'] });
    const compatible = await putDataset({ action: 'update', task_type: 'OutputOnly' });
    expect(compatible.status).toBe(400);
    expect((await compatible.json()).error).toContain('Task type "OutputOnly" expects 1 parameter, received 3.');

    mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: ['grader', ['in.txt', 'out.txt'], 'comparator'] });
    const unchangedType = await putDataset({ action: 'update', task_type: 'Batch' });
    expect(unchangedType.status).toBe(200);
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { task_type: 'Batch' } });
  });

  it('writes the defaults of a new task type when the dataset stored none', async () => {
    mocks.datasetFindUnique.mockResolvedValue({ task_type: 'Batch', task_type_parameters: [] });
    const response = await putDataset({ action: 'update', task_type: 'Communication' });
    expect(response.status).toBe(200);
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { task_type: 'Communication', task_type_parameters: [1, 'alone', 'std_io'] },
    });
  });

  it('leaves the stored list alone when neither task type nor parameters are sent', async () => {
    const response = await putDataset({ action: 'update', time_limit: 5 });
    expect(response.status).toBe(200);
    expect(mocks.datasetFindUnique).not.toHaveBeenCalled();
    expect(mocks.datasetUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { time_limit: 5 } });
  });

  it('rejects an unknown task type that the worker would not resolve', async () => {
    const response = await putDataset({ action: 'update', task_type: 'BatchAndOutput' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Unknown task type "BatchAndOutput".');
  });
});

describe('validateTaskTypeParams', () => {
  it('accepts what the worker accepts for each task type', () => {
    for (const [taskType, params] of Object.entries(VALID_PARAMS)) {
      expect(validateTaskTypeParams(taskType, params)).toEqual({ isValid: true, params });
    }
  });

  it('fails closed on a task type it cannot describe', () => {
    expect(validateTaskTypeParams('BatchAndOutput', ['alone', ['', ''], 'diff', '']))
      .toEqual({ isValid: false, message: 'Unknown task type "BatchAndOutput".' });
    expect(validateTaskTypeParams('', undefined)).toEqual({ isValid: false, message: 'Unknown task type "".' });
  });
});
