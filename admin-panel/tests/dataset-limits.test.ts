import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  datasetCreate: vi.fn(),
  datasetUpdate: vi.fn(),
  testcaseCreate: vi.fn(),
  managerCreate: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    datasets: { create: mocks.datasetCreate, update: mocks.datasetUpdate, findUnique: vi.fn() },
    testcases: { create: mocks.testcaseCreate },
    managers: { create: mocks.managerCreate },
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  getPermissions: vi.fn(async () => new Set(['dataset:read', 'dataset:create', 'dataset:update'])),
  ensurePermission: vi.fn(async () => {}),
}));

import { POST as createDatasetRoute } from '@/app/api/datasets/route';
import { PUT as updateDatasetRoute } from '@/app/api/datasets/[id]/route';
import { cloneDatasetRecords } from '@/lib/dataset-cloning';
import {
  BYTES_PER_MEBIBYTE,
  bytesToMebibytes,
  mebibytesToBytes,
  parseMemoryLimitMb,
  parseTimeLimit,
} from '@/lib/dataset-limits';

const BATCH_PARAMS = ['alone', ['', ''], 'diff'];
const MEBIBYTE = BigInt(1024 * 1024);
const MEMORY_256_MB = BigInt(256) * MEBIBYTE;

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

function createdData(): Record<string, unknown> {
  const call = mocks.datasetCreate.mock.calls.at(-1);
  if (!call) throw new Error('the route never reached the database');
  return (call[0] as { data: Record<string, unknown> }).data;
}

function updatedData(): Record<string, unknown> {
  const call = mocks.datasetUpdate.mock.calls.at(-1);
  if (!call) throw new Error('the route never reached the database');
  return (call[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.datasetCreate.mockResolvedValue({ id: 7, memory_limit: null });
  mocks.datasetUpdate.mockResolvedValue({ id: 7 });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('the dataset limit parsers', () => {
  it('reads a blank, a 0, a negative and a non-number as no limit', () => {
    for (const blank of [undefined, null, '', 0, '0', -1, '-5', NaN, 'nonsense']) {
      expect(parseTimeLimit(blank), `time ${String(blank)}`).toEqual({ ok: true, value: null });
      expect(parseMemoryLimitMb(blank), `memory ${String(blank)}`).toEqual({ ok: true, value: null });
    }
  });

  it('keeps a positive fraction on the time limit, whose column is a float', () => {
    expect(parseTimeLimit(1.5)).toEqual({ ok: true, value: 1.5 });
    expect(parseTimeLimit('0.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('refuses a fractional MiB instead of clearing it, because the column cannot hold one', () => {
    const parsed = parseMemoryLimitMb(16.5);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('a fractional MiB must be refused');
    expect(parsed.message).toBe('Memory limit must be a whole number of megabytes');
  });

  // Why no upper bound is asserted as accepted rather than refused: the classic's own guard is only
  // `time_limit > 0` (`src/cms/grading/steps/evaluation.py:176`), so a panel-only cap would refuse to
  // save a dataset whose stored limit already sits above it — a worse failure than a typo. A big value
  // is a real limit.
  it('accepts a large limit instead of inventing an upper bound', () => {
    expect(parseTimeLimit(61)).toEqual({ ok: true, value: 61 });
    expect(parseTimeLimit(600)).toEqual({ ok: true, value: 600 });
    expect(parseMemoryLimitMb(4097)).toEqual({ ok: true, value: 4097 });
    expect(parseMemoryLimitMb(65536)).toEqual({ ok: true, value: 65536 });
  });
});

describe('the MiB/byte seam', () => {
  it('converts MiB to bytes and back', () => {
    expect(mebibytesToBytes(256)).toBe(MEMORY_256_MB);
    expect(bytesToMebibytes(MEMORY_256_MB)).toBe(256);
    expect(bytesToMebibytes('268435456')).toBe(256);
    expect(BYTES_PER_MEBIBYTE).toBe(MEBIBYTE);
  });

  it('keeps null null in both directions', () => {
    expect(mebibytesToBytes(null)).toBeNull();
    expect(bytesToMebibytes(null)).toBeNull();
    expect(bytesToMebibytes(undefined)).toBeNull();
  });

  it('does not invent a byte count for a MiB value that is not a whole positive number', () => {
    expect(mebibytesToBytes(0)).toBeNull();
    expect(mebibytesToBytes(-4)).toBeNull();
    expect(mebibytesToBytes(16.5)).toBeNull();
  });
});

describe('creating a dataset', () => {
  it('stores SQL NULL when no limit is sent, blanked or zeroed', async () => {
    for (const body of [{}, { time_limit: null, memory_limit: null }, { time_limit: '', memory_limit: '' }, { time_limit: 0, memory_limit: 0 }]) {
      const response = await postDataset({ taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: BATCH_PARAMS, ...body });
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(createdData().time_limit, JSON.stringify(body)).toBeNull();
      expect(createdData().memory_limit, JSON.stringify(body)).toBeNull();
    }
  });

  it('stores the time as given and the memory as bytes', async () => {
    const response = await postDataset({ taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: BATCH_PARAMS, time_limit: 1.5, memory_limit: 256 });
    expect(response.status).toBe(200);
    expect(createdData().time_limit).toBe(1.5);
    expect(createdData().memory_limit).toBe(MEMORY_256_MB);
  });

  it('answers a fractional MiB with a 400 and never reaches the database', async () => {
    const response = await postDataset({ taskId: 1, description: 'Base', task_type: 'Batch', task_type_parameters: BATCH_PARAMS, memory_limit: 16.5 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Memory limit must be a whole number of megabytes');
    expect(mocks.datasetCreate).not.toHaveBeenCalled();
  });
});

describe('updating a dataset', () => {
  it('writes SQL NULL for an explicit clear rather than dropping or coercing it', async () => {
    const response = await putDataset({ action: 'update', time_limit: null, memory_limit: null });
    expect(response.status).toBe(200);
    expect(updatedData()).toEqual({ time_limit: null, memory_limit: null });
  });

  it('clears a 0 and a blank the same way an empty box does', async () => {
    await putDataset({ action: 'update', time_limit: 0, memory_limit: '' });
    expect(updatedData()).toEqual({ time_limit: null, memory_limit: null });
  });

  it('keeps a fractional time and converts a whole MiB to bytes', async () => {
    await putDataset({ action: 'update', time_limit: 2.5, memory_limit: 64 });
    expect(updatedData()).toEqual({ time_limit: 2.5, memory_limit: BigInt(64) * MEBIBYTE });
  });

  it('refuses a fractional MiB with a 400 and touches nothing', async () => {
    const response = await putDataset({ action: 'update', memory_limit: 16.5 });
    expect(response.status).toBe(400);
    expect(mocks.datasetUpdate).not.toHaveBeenCalled();
  });
});

type CloneInput = Parameters<typeof cloneDatasetRecords>[0];

function cloneSource(limits: { time_limit: number | null; memory_limit: bigint | null }): CloneInput {
  return {
    id: 3, task_id: 9, description: 'Live', autojudge: false,
    time_limit: limits.time_limit, memory_limit: limits.memory_limit,
    task_type: 'Batch', task_type_parameters: BATCH_PARAMS, score_type: 'Sum', score_type_parameters: [],
    testcases: [], managers: [],
  };
}

describe('cloning a dataset', () => {
  it('keeps a null limit null instead of filling in a default', async () => {
    mocks.datasetCreate.mockResolvedValue({ id: 8 });
    await cloneDatasetRecords(cloneSource({ time_limit: null, memory_limit: null }), 'Copy');

    const clone = (mocks.datasetCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(clone.time_limit).toBeNull();
    expect(clone.memory_limit).toBeNull();
  });

  it('copies a stored pair unchanged, bytes and all', async () => {
    mocks.datasetCreate.mockResolvedValue({ id: 8 });
    await cloneDatasetRecords(cloneSource({ time_limit: 1.5, memory_limit: MEMORY_256_MB }), 'Copy');

    const clone = (mocks.datasetCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(clone.time_limit).toBe(1.5);
    expect(clone.memory_limit).toBe(MEMORY_256_MB);
  });
});
