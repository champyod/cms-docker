import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCount = vi.fn();
const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
const mockFindUnique = vi.fn();
const mockInvalidate = vi.fn();
const mockAudit = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ recordAudit: (...args: unknown[]) => mockAudit(...args) }));
vi.mock('@/lib/evaluation-rpc', () => ({
  invalidateViaRpc: (...args: unknown[]) => mockInvalidate(...args),
}));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => undefined),
  getPermissions: vi.fn(async () => new Set()),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: {
      count: (...args: unknown[]) => mockCount(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    evaluations: { deleteMany: (...args: unknown[]) => mockDeleteMany(...args) },
    submission_results: { deleteMany: (...args: unknown[]) => mockDeleteMany(...args) },
  },
}));

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

describe('previewBatchRecalculation', () => {
  it('reports the match count and that it is under the cap', async () => {
    mockCount.mockResolvedValue(12);
    const { previewBatchRecalculation } = await loadModule();
    expect(await previewBatchRecalculation({ taskId: 5 })).toEqual({
      matched: 12,
      willProcess: 12,
      capped: false,
    });
  });

  it('reports the cap and keeps the true match count visible', async () => {
    mockCount.mockResolvedValue(900);
    const { previewBatchRecalculation } = await loadModule();
    expect(await previewBatchRecalculation({ contestId: 1 })).toEqual({
      matched: 900,
      willProcess: 200,
      capped: true,
    });
  });

  it('scopes the count by task and by contest', async () => {
    mockCount.mockResolvedValue(0);
    const { previewBatchRecalculation } = await loadModule();
    await previewBatchRecalculation({ contestId: 3, taskId: 5, userId: 9 });
    const where = mockCount.mock.calls[0][0].where;
    expect(where.task_id).toBe(5);
    expect(where.participations).toEqual({ contest_id: 3, user_id: 9 });
  });

  it('sends an unscoped count when the scope is empty', async () => {
    mockCount.mockResolvedValue(0);
    const { previewBatchRecalculation } = await loadModule();
    await previewBatchRecalculation({});
    expect(mockCount.mock.calls[0][0].where).toEqual({});
  });
});

describe('recalculateSubmissions', () => {
  function acceptRpc(): void {
    mockInvalidate.mockResolvedValue({ accepted: true, timedOut: false });
    mockFindUnique.mockResolvedValue({ submission_results: [{ dataset_id: 1 }], tasks: { active_dataset_id: 1 } });
  }

  it('requeues every matched submission and reports a clean run', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2), submission(3)]);
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({ taskId: 5 }, 'score');

    expect(report.processed).toBe(3);
    expect(report.succeeded).toBe(3);
    expect(report.failed).toBe(0);
    expect(mockInvalidate).toHaveBeenCalledTimes(3);
  });

  it('reads the batch in ascending id order, so a partial run is reproducible', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score');
    expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
  });

  it('caps the query at the batch limit', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score');
    expect(mockFindMany.mock.calls[0][0].take).toBe(200);
  });

  // Why this is the load-bearing case: one dead submission must not abandon the rest of
  // the batch, and the operator needs to know which ones did not go.
  it('keeps going when one submission fails, and names it', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    mockFindUnique.mockResolvedValue({ submission_results: [{ dataset_id: 1 }], tasks: { active_dataset_id: 1 } });
    mockInvalidate
      .mockResolvedValueOnce({ accepted: false, timedOut: true })
      .mockResolvedValueOnce({ accepted: true, timedOut: false });
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score');

    expect(report.processed).toBe(2);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]).toMatchObject({ submissionId: 1, ok: false });
    expect(report.outcomes[1]).toMatchObject({ submissionId: 2, ok: true });
  });

  it('contains a thrown error as that item\u2019s outcome', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    acceptRpc();
    mockInvalidate.mockRejectedValueOnce(new Error('socket closed'));
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score');

    expect(report.processed).toBe(2);
    expect(report.outcomes[0].error).toContain('socket closed');
    expect(report.outcomes[1].ok).toBe(true);
  });

  it('reports capped when the query filled the limit', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 200 }, (_, index) => submission(index + 1)));
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score');
    expect(report.capped).toBe(true);
  });

  it('writes one batch audit row naming the scope', async () => {
    mockFindMany.mockResolvedValue([submission(1)]);
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({ contestId: 2, taskId: 7 }, 'score');

    const batchRows = mockAudit.mock.calls.filter(([entry]) => entry.entityId === 'contest=2 task=7');
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0][0].afterValues).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('labels an unscoped batch explicitly rather than leaving it blank', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score');
    expect(mockAudit.mock.calls.some(([entry]) => entry.entityId === 'all')).toBe(true);
  });
});
