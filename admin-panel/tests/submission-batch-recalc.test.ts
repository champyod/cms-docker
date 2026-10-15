import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCount = vi.fn();
const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
const mockFindUnique = vi.fn();
const mockDatasetFindFirst = vi.fn();
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
    datasets: { findFirst: (...args: unknown[]) => mockDatasetFindFirst(...args) },
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

const OPTIONS = { reason: 'scheduled re-score after judge fix' };

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
      limit: 200,
    });
  });

  it('reports the cap and keeps the true match count visible', async () => {
    mockCount.mockResolvedValue(900);
    const { previewBatchRecalculation } = await loadModule();
    expect(await previewBatchRecalculation({ contestId: 1 })).toEqual({
      matched: 900,
      willProcess: 200,
      capped: true,
      limit: 200,
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

describe('previewRecalculationByIds', () => {
  it('counts the deduplicated id selection with the same preview shape', async () => {
    mockCount.mockResolvedValue(2);
    const { previewRecalculationByIds } = await loadModule();
    expect(await previewRecalculationByIds([7, 7, 3])).toEqual({
      matched: 2,
      willProcess: 2,
      capped: false,
      limit: 200,
    });
    expect(mockCount.mock.calls[0][0].where).toEqual({ id: { in: [3, 7] } });
  });

  it('reports the cap once the selection fills the limit', async () => {
    mockCount.mockResolvedValue(201);
    const { previewRecalculationByIds } = await loadModule();
    const preview = await previewRecalculationByIds([1]);
    expect(preview.capped).toBe(true);
    expect(preview.willProcess).toBe(200);
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
    const report = await recalculateSubmissions({ taskId: 5 }, 'score', OPTIONS);

    expect(report.processed).toBe(3);
    expect(report.succeeded).toBe(3);
    expect(report.failed).toBe(0);
    expect(mockInvalidate).toHaveBeenCalledTimes(3);
  });

  it('reads the batch in ascending id order, so a partial run is reproducible', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score', OPTIONS);
    expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
  });

  it('caps the query at the batch limit', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score', OPTIONS);
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
    const report = await recalculateSubmissions({}, 'score', OPTIONS);

    expect(report.processed).toBe(2);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.outcomes[0]).toMatchObject({ submissionId: 1, ok: false, timedOut: true });
    expect(report.outcomes[1]).toMatchObject({ submissionId: 2, ok: true });
    expect(report.outcomes[1].timedOut).toBeUndefined();
  });

  it('contains a thrown error as that item\u2019s outcome', async () => {
    mockFindMany.mockResolvedValue([submission(1), submission(2)]);
    acceptRpc();
    mockInvalidate.mockRejectedValueOnce(new Error('socket closed'));
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score', OPTIONS);

    expect(report.processed).toBe(2);
    expect(report.outcomes[0].error).toContain('socket closed');
    expect(report.outcomes[1].ok).toBe(true);
  });

  it('reports capped when the query filled the limit', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 200 }, (_, index) => submission(index + 1)));
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score', OPTIONS);
    expect(report.capped).toBe(true);
  });

  it('writes one batch audit row naming the scope', async () => {
    mockFindMany.mockResolvedValue([submission(1)]);
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({ contestId: 2, taskId: 7 }, 'score', OPTIONS);

    const batchRows = mockAudit.mock.calls.filter(([entry]) => entry.entityId === 'contest=2 task=7');
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0][0].afterValues).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('labels an unscoped batch explicitly rather than leaving it blank', async () => {
    mockFindMany.mockResolvedValue([]);
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({}, 'score', OPTIONS);
    expect(mockAudit.mock.calls.some(([entry]) => entry.entityId === 'all')).toBe(true);
  });

  it('refuses the whole batch when the reason is blank', async () => {
    const { recalculateSubmissions } = await loadModule();
    const report = await recalculateSubmissions({}, 'score', { reason: '   ' });

    expect(report.error).toContain('reason');
    expect(report.processed).toBe(0);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('carries the reason on the batch row and on every per-item row', async () => {
    mockFindMany.mockResolvedValue([submission(1)]);
    acceptRpc();
    const { recalculateSubmissions } = await loadModule();
    await recalculateSubmissions({ taskId: 3 }, 'score', { reason: ' judge hotfix landed' });

    const rows = mockAudit.mock.calls.map(([entry]) => entry);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.reason).toBe('judge hotfix landed');
  });
});

describe('recalculateSubmissionIds', () => {
  function acceptRpc(): void {
    mockInvalidate.mockResolvedValue({ accepted: true, timedOut: false });
    mockFindUnique.mockResolvedValue({ submission_results: [{ dataset_id: 1 }], tasks: { active_dataset_id: 1 } });
  }

  it('runs exactly the selected ids in ascending order', async () => {
    mockFindMany.mockResolvedValue([submission(2), submission(5)]);
    acceptRpc();
    const { recalculateSubmissionIds } = await loadModule();
    const report = await recalculateSubmissionIds([5, 2, 5], 'evaluation', OPTIONS);

    expect(mockFindMany.mock.calls[0][0].where).toEqual({ id: { in: [2, 5] } });
    expect(mockFindMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
    expect(report.processed).toBe(2);
    expect(report.succeeded).toBe(2);
    expect(report.error).toBeUndefined();
    expect(mockAudit.mock.calls.some(([entry]) => entry.entityId === 'ids=2,5')).toBe(true);
  });

  it('requires a reason before it touches the database', async () => {
    const { recalculateSubmissionIds } = await loadModule();
    const report = await recalculateSubmissionIds([1], 'full', { reason: '' });

    expect(report.error).toContain('reason');
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('treats an empty selection as a no-op instead of an all-batch', async () => {
    const { recalculateSubmissionIds } = await loadModule();
    const report = await recalculateSubmissionIds([], 'score', OPTIONS);

    expect(report).toEqual({ processed: 0, succeeded: 0, failed: 0, capped: false, outcomes: [] });
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('caps the selection at the batch limit and flags it', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 200 }, (_, index) => submission(index + 1)));
    acceptRpc();
    const { recalculateSubmissionIds } = await loadModule();
    const report = await recalculateSubmissionIds([1, 2, 3], 'score', OPTIONS);
    expect(report.capped).toBe(true);
    expect(mockFindMany.mock.calls[0][0].take).toBe(200);
  });
});

describe('recalculation dataset selection', () => {
  function submissionRow(): unknown {
    return {
      task_id: 9,
      submission_results: [{ dataset_id: 1 }],
      tasks: { active_dataset_id: 1, contest_tasks: [{ contest_id: 4 }] },
    };
  }

  it('runs against a dataset that belongs to the submission\u2019s task', async () => {
    mockFindUnique.mockResolvedValue(submissionRow());
    mockDatasetFindFirst.mockResolvedValue({ id: 7 });
    mockInvalidate.mockResolvedValue({ accepted: true, timedOut: false });
    const { recalculateSubmission } = await loadModule();

    const outcome = await recalculateSubmission(11, 'score', { ...OPTIONS, datasetId: 7 });

    expect(outcome).toMatchObject({ success: true, datasetId: 7 });
    expect(mockDatasetFindFirst.mock.calls[0][0].where).toEqual({ id: 7, task_id: 9 });
    expect(mockInvalidate).toHaveBeenCalledWith(11, 7, 'score', 4);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { submission_id: 11, dataset_id: 7 } });
  });

  it('rejects a dataset that belongs to another task before calling the RPC', async () => {
    mockFindUnique.mockResolvedValue(submissionRow());
    mockDatasetFindFirst.mockResolvedValue(null);
    const { recalculateSubmission } = await loadModule();

    const outcome = await recalculateSubmission(11, 'score', { ...OPTIONS, datasetId: 99 });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('does not belong');
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('keeps the derived dataset when none is requested', async () => {
    mockFindUnique.mockResolvedValue(submissionRow());
    mockInvalidate.mockResolvedValue({ accepted: true, timedOut: false });
    const { recalculateSubmission } = await loadModule();

    const outcome = await recalculateSubmission(11, 'score', OPTIONS);

    expect(outcome).toMatchObject({ success: true, datasetId: 1 });
    expect(mockDatasetFindFirst).not.toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalledWith(11, 1, 'score', 4);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { submission_id: 11 } });
  });

  it('refuses a single run without a reason, before the RPC', async () => {
    const { recalculateSubmission } = await loadModule();
    const outcome = await recalculateSubmission(11, 'full', { reason: '' });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('reason');
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe('timeout signalling', () => {
  it('marks an RPC timeout so the UI can offer a retry', async () => {
    mockFindUnique.mockResolvedValue({
      task_id: 9,
      submission_results: [{ dataset_id: 1 }],
      tasks: { active_dataset_id: 1, contest_tasks: [{ contest_id: 4 }] },
    });
    mockInvalidate.mockResolvedValue({ accepted: false, timedOut: true });
    const { recalculateSubmission } = await loadModule();

    const outcome = await recalculateSubmission(11, 'score', OPTIONS);

    expect(outcome.success).toBe(false);
    expect(outcome.timedOut).toBe(true);
    expect(outcome.error).toContain('did not respond in time');
  });

  it('leaves timedOut unset on a refusal that was not a timeout', async () => {
    mockFindUnique.mockResolvedValue({
      task_id: 9,
      submission_results: [{ dataset_id: 1 }],
      tasks: { active_dataset_id: 1, contest_tasks: [{ contest_id: 4 }] },
    });
    mockInvalidate.mockResolvedValue({ accepted: false, timedOut: false });
    const { recalculateSubmission } = await loadModule();

    const outcome = await recalculateSubmission(11, 'score', OPTIONS);

    expect(outcome.success).toBe(false);
    expect(outcome.timedOut).toBeUndefined();
  });
});
