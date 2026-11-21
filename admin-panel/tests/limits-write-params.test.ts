import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  tasksUpdate: vi.fn(),
  tasksFindUnique: vi.fn(),
  contestsFindUnique: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contests: { findUnique: mocks.contestsFindUnique, findMany: vi.fn(async () => []) },
    tasks: { findUnique: mocks.tasksFindUnique, update: mocks.tasksUpdate, findMany: vi.fn(async () => []) },
    participations: { findMany: vi.fn(async () => []) },
    $executeRaw: mocks.executeRaw,
    $executeRawUnsafe: mocks.executeRawUnsafe,
    $queryRaw: vi.fn(async () => [{ id: 1 }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
// Why `all:all`: one key the shared engine expands, so every field-stripping gate keeps the
// limit columns instead of the tests having to enumerate the whole registry.
vi.mock('@/lib/server/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/authorization')>();
  return { ...actual, requirePermission: vi.fn(async () => new Set(['all:all'])) };
});

type RawCall = { strings: string[]; values: unknown[] };

function lastRawCall(mock: { mock: { calls: unknown[][] } }): RawCall {
  const call = mock.mock.calls.at(-1);
  if (call === undefined) throw new Error('no raw call was made');
  const strings = [...(call[0] as unknown as string[])];
  return { strings, values: call.slice(1) };
}

function segmentIndex(strings: string[], needle: string): number {
  const index = strings.findIndex((segment) => segment.includes(needle));
  if (index < 0) throw new Error(`no SQL segment for ${needle}`);
  return index;
}

/** A `CASE WHEN ${touched} THEN ${value}` pair: the flag that says whether the column is named. */
function caseParam({ strings, values }: RawCall, column: string): { flag: unknown; value: unknown } {
  const index = segmentIndex(strings, `${column} = CASE WHEN `);
  return { flag: values[index], value: values[index + 1] };
}

/** The first bound value after a `COALESCE(` in the statement. */
function coalescedValue({ strings, values }: RawCall, expression: string): unknown {
  return values[segmentIndex(strings, `${expression} = COALESCE`)];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockResolvedValue(1);
  mocks.executeRawUnsafe.mockResolvedValue(1);
  mocks.tasksUpdate.mockResolvedValue({});
  mocks.tasksFindUnique.mockResolvedValue({ id: 5 });
  mocks.contestsFindUnique.mockResolvedValue({ id: 5 });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('the contest write path normalises limits before they reach a CHECK', () => {
  it('turns a 0 and an explicit clear into NULL in the written parameters', async () => {
    const { updateContest } = await import('@/lib/services/contests');
    const result = await updateContest(5, {
      max_submission_number: 0,
      max_user_test_number: 20,
      min_submission_interval: 0,
      min_user_test_interval: null,
    });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRaw);
    expect(caseParam(raw, 'max_submission_number')).toEqual({ flag: true, value: null });
    expect(caseParam(raw, 'max_user_test_number')).toEqual({ flag: true, value: 20 });
    expect(caseParam(raw, 'min_submission_interval')).toEqual({ flag: true, value: null });
    expect(caseParam(raw, 'min_user_test_interval')).toEqual({ flag: true, value: null });
    // Nothing bound for a limit can be the literal 0 the database refuses.
    expect(raw.values).not.toContain(0);
  });

  it('keeps a window-only update away from the four limit columns', async () => {
    const { updateContestWindow } = await import('@/lib/services/contests');
    const result = await updateContestWindow(7, { timezone: 'Asia/Bangkok' });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRaw);
    for (const column of ['token_max_number', 'token_gen_max', 'max_submission_number', 'max_user_test_number']) {
      expect(caseParam(raw, column), column).toEqual({ flag: false, value: null });
    }
    for (const column of ['min_submission_interval', 'min_user_test_interval', 'per_user_time', 'min_submission_interval_grace_period']) {
      expect(caseParam(raw, column), column).toEqual({ flag: false, value: null });
    }
    // The window value it did carry is still written.
    expect(coalescedValue(raw, 'timezone')).toBe('Asia/Bangkok');
  });

  it('writes a cleared minimum interval as NULL rather than leaving the column alone', async () => {
    const { updateContestLimits } = await import('@/lib/services/contests');
    const result = await updateContestLimits(5, { min_submission_interval: null, max_submission_number: 5 });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRaw);
    // Touched with a null value: the `THEN NULL::interval` branch runs, the ELSE branch does not.
    expect(caseParam(raw, 'min_submission_interval')).toEqual({ flag: true, value: null });
    expect(caseParam(raw, 'max_submission_number')).toEqual({ flag: true, value: 5 });
    expect(caseParam(raw, 'token_max_number')).toEqual({ flag: false, value: null });
  });
});

describe('the task write path normalises limits before they reach a CHECK', () => {
  it('turns a 0 into NULL in the written parameters', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    const result = await updateTask(5, { max_submission_number: 0, max_user_test_number: 7, min_submission_interval: 0 });

    expect(result.success).toBe(true);
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { max_submission_number: null, max_user_test_number: 7 },
    });
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(raw.strings.join('')).toContain('min_submission_interval = NULL');
    expect(raw.strings.join('')).not.toMatch(/min_submission_interval = \$/);
    expect(raw.values).toEqual([5]);
    expect(mocks.executeRawUnsafe.mock.calls[0][1]).not.toBe(0);
  });

  it('leaves an interval the update never names out of the statement entirely', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    await updateTask(5, { max_user_test_number: 3 });

    // Absent means leave alone: no interval clause at all, not a NULL one.
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { max_user_test_number: 3 } });
  });

  it('writes a cleared minimum interval as NULL through the bulk limit service', async () => {
    const { updateTaskLimits } = await import('@/lib/services/tasks');
    const result = await updateTaskLimits(5, { min_submission_interval: null, token_max_number: 30 });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(raw.strings.join('')).toContain('min_submission_interval = NULL');
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { token_max_number: 30 } });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'task:update', entityId: '5' }));
  });

  it('turns a 0 into NULL on the API update path too', async () => {
    const { updateTaskViaApi } = await import('@/lib/services/tasks');
    const result = await updateTaskViaApi(5, { min_submission_interval: 0, max_submission_number: 0 });

    expect(result.success).toBe(true);
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { max_submission_number: null } });
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(raw.strings.join('')).toContain('min_submission_interval = NULL');
  });

  it('refuses a bulk patch on a target that is not there, so the route can name it', async () => {
    mocks.tasksFindUnique.mockResolvedValue(null);
    const { updateTaskLimits } = await import('@/lib/services/tasks');
    const result = await updateTaskLimits(99, { max_submission_number: 3 });

    expect(result).toEqual({ success: false, error: 'Task not found' });
    expect(mocks.tasksUpdate).not.toHaveBeenCalled();
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });
});
