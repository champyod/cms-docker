import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCount = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
const mockAudit = vi.fn();
const mockStrip = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordAudit: (...args: unknown[]) => mockAudit(...args) }));
vi.mock('@/lib/evaluation-rpc', () => ({ invalidateViaRpc: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => undefined),
  getPermissions: vi.fn(async () => new Set(['submission:read', 'submission:update'])),
}));
vi.mock('@/lib/field-permissions', () => ({
  stripDisallowedFields: (...args: unknown[]) => mockStrip(...(args as [string, Record<string, unknown>, ReadonlySet<string>])),
  getFieldAccess: () => ({}),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: {
      count: (...args: unknown[]) => mockCount(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { revalidatePath } from 'next/cache';

beforeEach(() => {
  vi.clearAllMocks();
  mockStrip.mockImplementation((_entity: string, data: Record<string, unknown>) => data);
  mockAudit.mockResolvedValue(undefined);
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function loadModule() {
  vi.resetModules();
  return import('@/app/actions/submissions');
}

function submission(id: number) {
  return { id };
}

describe('previewCommentApplication', () => {
  it('reports the match count and that it is under the cap', async () => {
    mockCount.mockResolvedValue(12);
    const { previewCommentApplication } = await loadModule();
    expect(await previewCommentApplication({ taskId: 5 })).toEqual({
      matched: 12,
      willProcess: 12,
      capped: false,
      limit: 200,
    });
  });

  it('reports the cap and keeps the true match count visible', async () => {
    mockCount.mockResolvedValue(900);
    const { previewCommentApplication } = await loadModule();
    expect(await previewCommentApplication({ contestId: 1 })).toEqual({
      matched: 900,
      willProcess: 200,
      capped: true,
      limit: 200,
    });
  });

  it('scopes the count by task, contest and user', async () => {
    mockCount.mockResolvedValue(0);
    const { previewCommentApplication } = await loadModule();
    await previewCommentApplication({ contestId: 3, taskId: 5, userId: 9 });
    const where = mockCount.mock.calls[0][0].where;
    expect(where.task_id).toBe(5);
    expect(where.participations).toEqual({ contest_id: 3, user_id: 9 });
  });
});

describe('previewCommentApplicationByIds', () => {
  it('counts the deduplicated id selection with the same preview shape', async () => {
    mockCount.mockResolvedValue(2);
    const { previewCommentApplicationByIds } = await loadModule();
    expect(await previewCommentApplicationByIds([7, 7, 3])).toEqual({
      matched: 2,
      willProcess: 2,
      capped: false,
      limit: 200,
    });
    expect(mockCount.mock.calls[0][0].where).toEqual({ id: { in: [3, 7] } });
  });
});

describe('applyCommentToSubmissions', () => {
  it('writes the comment only where it differs, with a per-item audit row', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { applyCommentToSubmissions } = await loadModule();

    const report = await applyCommentToSubmissions({ taskId: 5 }, '  why  ');

    expect(report).toMatchObject({ processed: 2, updated: 1, failed: 0, capped: false });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, comment: { not: '  why  ' } },
      data: { comment: '  why  ' },
    });
    const perItem = mockAudit.mock.calls.map(([entry]) => entry).filter((entry) => entry.entityId === '1');
    expect(perItem).toHaveLength(1);
    expect(perItem[0]).toMatchObject({ verb: 'submission:update', afterValues: { comment: '  why  ' } });
  });

  it('writes one batch audit row naming the scope and counting the run', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const { applyCommentToSubmissions } = await loadModule();

    await applyCommentToSubmissions({ contestId: 2, taskId: 7 }, 'checker fixed');

    const batchRows = mockAudit.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.entityId === 'contest=2 task=7');
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0].afterValues).toMatchObject({
      comment: 'checker fixed',
      processed: 2,
      updated: 2,
      failed: 0,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('reads the batch in ascending id order and caps the query', async () => {
    mockFindMany.mockResolvedValue([]);
    const { applyCommentToSubmissions } = await loadModule();
    await applyCommentToSubmissions({}, 'note');

    expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
    expect(mockFindMany.mock.calls[0][0].take).toBe(200);
  });

  it('reports capped when the query filled the limit', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 200 }, (_, index) => submission(index + 1)));
    const { applyCommentToSubmissions } = await loadModule();
    const report = await applyCommentToSubmissions({}, 'note');
    expect(report.capped).toBe(true);
  });

  it('contains a thrown write as that item\u2019s failure instead of abandoning the batch', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    mockUpdateMany
      .mockRejectedValueOnce(new Error('deadlock'))
      .mockResolvedValueOnce({ count: 1 });
    const { applyCommentToSubmissions } = await loadModule();

    const report = await applyCommentToSubmissions({}, 'note');

    expect(report).toMatchObject({ processed: 2, updated: 1, failed: 1 });
    expect(report.outcomes[0]).toMatchObject({ submissionId: 1, ok: false, error: 'deadlock' });
    expect(report.outcomes[1]).toMatchObject({ submissionId: 2, ok: true, changed: true });
  });

  it('refuses a blank comment before it touches the database', async () => {
    const { applyCommentToSubmissions } = await loadModule();
    const report = await applyCommentToSubmissions({}, '   ');

    expect(report.error).toContain('required');
    expect(report.processed).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses a comment past the shared length limit', async () => {
    const { applyCommentToSubmissions } = await loadModule();
    const report = await applyCommentToSubmissions({}, 'x'.repeat(2001));

    expect(report.error).toContain('2000');
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('refuses when the field map withholds the comment column', async () => {
    mockStrip.mockReturnValue({});
    const { applyCommentToSubmissions } = await loadModule();
    const report = await applyCommentToSubmissions({}, 'note');

    expect(report.error).toContain('comment field');
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe('applyCommentToSubmissionIds', () => {
  it('runs exactly the deduplicated selection and labels the batch by ids', async () => {
    mockFindMany.mockResolvedValue([submission(2), submission(5)]);
    const { applyCommentToSubmissionIds } = await loadModule();

    const report = await applyCommentToSubmissionIds([5, 2, 5], 'note');

    expect(mockFindMany.mock.calls[0][0].where).toEqual({ id: { in: [2, 5] } });
    expect(report.processed).toBe(2);
    expect(mockAudit.mock.calls.some(([entry]) => entry.entityId === 'ids=2,5')).toBe(true);
  });

  it('treats an empty selection as a no-op instead of an all-batch', async () => {
    const { applyCommentToSubmissionIds } = await loadModule();
    const report = await applyCommentToSubmissionIds([], 'note');

    expect(report).toEqual({ processed: 0, updated: 0, failed: 0, capped: false, outcomes: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
