import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMIT_FIELDS, normalizeLimitValue, normalizeNonNegativeInt } from '@/lib/limits';
import { FIELD_PERMISSION_MAP } from '@/lib/field-permissions';
import { buildContestInsertDefaults } from '@/lib/contests-repo';
import type { ContestData } from '@/lib/contests-repo';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  queryRaw: vi.fn(),
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
    $queryRaw: mocks.queryRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
  },
}));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
// Why `all:all`: one key the shared engine expands, so the field-stripping gate keeps every column
// the tests name instead of each test having to enumerate the whole permission registry.
vi.mock('@/lib/server/authorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/authorization')>();
  return { ...actual, requirePermission: vi.fn(async () => new Set(['all:all'])) };
});

type RawCall = { strings: string[]; values: unknown[] };

/** A `$executeRaw` template call or a `$executeRawUnsafe` call, read the same way. */
function lastRawCall(mock: { mock: { calls: unknown[][] } }): RawCall {
  const call = mock.mock.calls.at(-1);
  if (call === undefined) throw new Error('no raw call was made');
  return { strings: [...(call[0] as unknown as string[])], values: call.slice(1) };
}

function statement(raw: RawCall): string {
  return raw.strings.join('');
}

function segmentIndex(strings: string[], needle: string): number {
  const index = strings.findIndex((segment) => segment.includes(needle));
  if (index < 0) throw new Error(`no SQL segment for ${needle}`);
  return index;
}

/** A `column = CASE WHEN ${touched} THEN ${value}` pair: the flag that says whether the column is named. */
function caseParam(raw: RawCall, column: string): { flag: unknown; value: unknown } {
  const index = segmentIndex(raw.strings, `${column} = CASE WHEN `);
  return { flag: raw.values[index], value: raw.values[index + 1] };
}

const THROTTLE_INT_COLUMNS = ['evaluation_throttle_delay_s', 'evaluation_throttle_window_s', 'evaluation_throttle_max'] as const;
const RESERVED_COLUMNS = ['evaluation_throttle_window_s', 'evaluation_throttle_max', 'evaluation_final_open', 'evaluation_final_open_at'] as const;

function contestData(patch: Partial<ContestData> = {}): ContestData {
  return {
    name: 'throttle-contest', description: 'A contest', start: '2026-12-31T08:00:00.000Z',
    stop: '2026-12-31T13:00:00.000Z', timezone: 'Asia/Bangkok',
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockResolvedValue(1);
  mocks.executeRawUnsafe.mockResolvedValue(1);
  mocks.queryRaw.mockResolvedValue([{ id: 9 }]);
  mocks.tasksUpdate.mockResolvedValue({});
  mocks.tasksFindUnique.mockResolvedValue({ id: 5 });
  mocks.contestsFindUnique.mockResolvedValue({ id: 5 });
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe('the shared non-negative rule the throttle family reads its numbers with', () => {
  it('keeps a 0 as a real 0 and refuses a blank, a negative or a fraction', () => {
    expect(normalizeNonNegativeInt(0)).toBe(0);
    expect(normalizeNonNegativeInt('0')).toBe(0);
    expect(normalizeNonNegativeInt(45)).toBe(45);
    expect(normalizeNonNegativeInt('45')).toBe(45);
    expect(normalizeNonNegativeInt(-3)).toBeNull();
    expect(normalizeNonNegativeInt(2.5)).toBeNull();
    expect(normalizeNonNegativeInt('')).toBeNull();
    expect(normalizeNonNegativeInt(null)).toBeNull();
    expect(normalizeNonNegativeInt('abc')).toBeNull();
  });

  it('is a third reading, not a loosening of the two the limit columns use', () => {
    // The two older rules still collapse a 0 to "no limit"; only the new one keeps it.
    for (const field of LIMIT_FIELDS) expect(typeof field).toBe('string');
    expect(normalizeLimitValue(0)).toBeNull();
    expect(normalizeNonNegativeInt(0)).toBe(0);
  });
});

describe('the contest write path keeps the throttle delay out of the limit rule', () => {
  it('writes a typed 0 as a 0, never as the NULL the NOT NULL column cannot hold', async () => {
    const { updateContest } = await import('@/lib/services/contests');
    const result = await updateContest(5, { evaluation_throttle_delay_s: 0 });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRaw);
    expect(caseParam(raw, 'evaluation_throttle_delay_s')).toEqual({ flag: true, value: 0 });
  });

  it('writes a named delay as itself and leaves the columns the update does not name alone', async () => {
    const { updateContest } = await import('@/lib/services/contests');
    await updateContest(5, { evaluation_throttle_delay_s: 30, max_submission_number: 0 });

    const raw = lastRawCall(mocks.executeRaw);
    expect(caseParam(raw, 'evaluation_throttle_delay_s')).toEqual({ flag: true, value: 30 });
    // Absent means leave alone: the flag is false, so the ELSE branch keeps the stored value.
    for (const column of RESERVED_COLUMNS) {
      expect(caseParam(raw, column), column).toEqual({ flag: false, value: null });
    }
  });

  it('keeps a window-only update away from every throttle column', async () => {
    const { updateContestWindow } = await import('@/lib/services/contests');
    const result = await updateContestWindow(7, { timezone: 'Asia/Bangkok' });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRaw);
    for (const column of [...THROTTLE_INT_COLUMNS, ...RESERVED_COLUMNS].filter((c, i, a) => a.indexOf(c) === i)) {
      expect(caseParam(raw, column), column).toEqual({ flag: false, value: null });
    }
  });
});

describe('the contest create still writes a non-null throttle delay', () => {
  it('defaults the delay, the window and the max to the column own 0, and final_open to false', () => {
    const defaults = buildContestInsertDefaults(contestData());

    expect(defaults.evaluation_throttle_delay_s).toBe(0);
    expect(defaults.evaluation_throttle_window_s).toBe(0);
    expect(defaults.evaluation_throttle_max).toBe(0);
    expect(defaults.evaluation_final_open).toBe(false);
  });

  it('keeps the values the form did give it', () => {
    const defaults = buildContestInsertDefaults(contestData({ evaluation_throttle_delay_s: 12, evaluation_throttle_window_s: 30 }));

    expect(defaults.evaluation_throttle_delay_s).toBe(12);
    expect(defaults.evaluation_throttle_window_s).toBe(30);
  });

  it('names every throttle column in the INSERT, so the NOT NULL delay is never omitted', async () => {
    const { createContest } = await import('@/lib/services/contests');
    const result = await createContest(contestData());

    expect(result.success).toBe(true);
    const sql = statement(lastRawCall(mocks.executeRaw));
    expect(sql).toContain('evaluation_throttle_delay_s, evaluation_throttle_window_s');
    expect(sql).toContain('evaluation_throttle_max, evaluation_final_open');
    // The values the create binds for them are numbers, never a NULL the delay column refuses.
    const raw = lastRawCall(mocks.executeRaw);
    expect(typeof raw.values.find((value) => value === 0)).toBe('number');
  });
});

describe('the task throttle override round-trips its three states', () => {
  it('writes a blank as a real NULL, which is "inherit the contest own delay"', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    const result = await updateTask(5, { evaluation_throttle_delay_s: null });

    expect(result.success).toBe(true);
    expect(mocks.tasksUpdate).not.toHaveBeenCalled();
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(statement(raw)).toContain('evaluation_throttle_delay_s = NULL');
    expect(raw.values).toEqual([5]);
  });

  it('writes a 0 as a bound 0, which is "no delay for this task" and not an inherit', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    const result = await updateTask(5, { evaluation_throttle_delay_s: 0 });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(statement(raw)).toContain('evaluation_throttle_delay_s = $1');
    expect(raw.values).toEqual([0, 5]);
  });

  it('writes N as N seconds for this task', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    const result = await updateTask(5, { evaluation_throttle_delay_s: 12 });

    expect(result.success).toBe(true);
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(statement(raw)).toContain('evaluation_throttle_delay_s = $1');
    expect(raw.values).toEqual([12, 5]);
  });

  it('leaves the override alone when the update never names it', async () => {
    const { updateTask } = await import('@/lib/services/tasks');
    await updateTask(5, { max_user_test_number: 3 });

    // Absent means leave alone: no override clause at all, not a NULL one.
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { max_user_test_number: 3 } });
  });

  it('keeps the override out of the bulk limit patch, which carries only the six shared limits', async () => {
    const { updateTaskLimits } = await import('@/lib/services/tasks');
    const result = await updateTaskLimits(5, { max_submission_number: 3 });

    expect(result.success).toBe(true);
    // The override has no bulk lane: a bulk patch must never decide a task's throttle by itself.
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
    expect(mocks.tasksUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { max_submission_number: 3 } });
  });

  it('carries the tri-state through the API update path', async () => {
    const { updateTaskViaApi } = await import('@/lib/services/tasks');
    const cleared = await updateTaskViaApi(5, { evaluation_throttle_delay_s: null });
    expect(cleared.success).toBe(true);
    expect(statement(lastRawCall(mocks.executeRawUnsafe))).toContain('evaluation_throttle_delay_s = NULL');

    const kept = await updateTaskViaApi(5, { evaluation_throttle_delay_s: 0 });
    expect(kept.success).toBe(true);
    const raw = lastRawCall(mocks.executeRawUnsafe);
    expect(statement(raw)).toContain('evaluation_throttle_delay_s = $1');
    expect(raw.values).toContain(0);
  });

  it('names the override in both task INSERTs, so a create can write it', async () => {
    const { createTask } = await import('@/lib/services/tasks');
    const created = await createTask({ name: 'aplusb', title: 'A Plus B', evaluation_throttle_delay_s: 7 });

    expect(created.success).toBe(true);
    expect(statement(lastRawCall(mocks.queryRaw))).toContain('evaluation_throttle_delay_s, feedback_level');

    const { createTaskViaApi } = await import('@/lib/services/tasks');
    mocks.queryRaw.mockResolvedValue([{ id: 10 }]);
    const viaApi = await createTaskViaApi({ name: 'aplusb2', title: 'A Plus B 2', evaluation_throttle_delay_s: 7 });
    expect(viaApi.success).toBe(true);
    expect(statement(lastRawCall(mocks.queryRaw))).toContain('evaluation_throttle_delay_s, feedback_level');
  });
});

describe('the throttle fields are registered where their neighbours are', () => {
  it('gates the five contest columns like the limit columns beside them', () => {
    const contests = FIELD_PERMISSION_MAP.contests;
    for (const field of ['evaluation_throttle_delay_s', ...RESERVED_COLUMNS]) {
      expect(contests[field], field).toEqual({ read: 'contest:read', update: 'contest:update' });
    }
    // The same key the neighbour the family sits beside carries.
    expect(contests.queue_fairness_penalty_seconds).toEqual(contests.evaluation_throttle_delay_s);
  });

  it('gates the task override like its limit neighbours', () => {
    expect(FIELD_PERMISSION_MAP.tasks.evaluation_throttle_delay_s).toEqual({ read: 'task:read', update: 'task:update' });
    expect(FIELD_PERMISSION_MAP.tasks.evaluation_throttle_delay_s).toEqual(FIELD_PERMISSION_MAP.tasks.min_submission_interval);
  });
});
