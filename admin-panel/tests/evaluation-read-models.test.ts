import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getSubmissionEvaluation,
  getSubmissionLogs,
  getSubmissionSummary,
  getSubmissionResults,
} from '@/lib/evaluation-read-models';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findUnique: vi.fn() },
    submission_results: { findMany: vi.fn() },
    evaluations: { findMany: vi.fn() },
    files: { findMany: vi.fn() },
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);
const mockSubmissionFindUnique = vi.mocked(prisma.submissions.findUnique);
const mockResultsFindMany = vi.mocked(prisma.submission_results.findMany);
const mockEvaluationsFindMany = vi.mocked(prisma.evaluations.findMany);
const mockFilesFindMany = vi.mocked(prisma.files.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmissionFindUnique.mockResolvedValue({ id: 19 } as never);
  mockResultsFindMany.mockResolvedValue([] as never);
  mockEvaluationsFindMany.mockResolvedValue([] as never);
  mockFilesFindMany.mockResolvedValue([] as never);
});

describe('Evaluation read models', () => {
  it.each([
    ['getSubmissionSummary', ['submission:read']],
    ['getSubmissionResults', ['submission:read', 'submissionresult:read', 'file:read']],
    ['getSubmissionLogs', ['submission:read', 'submissionresult:read']],
    ['getSubmissionEvaluation', ['submission:read', 'evaluation:read']],
  ] as const)('%s requires its exact reader set', async (functionName, requiredKeys) => {
    const readers = {
      getSubmissionSummary,
      getSubmissionResults,
      getSubmissionLogs,
      getSubmissionEvaluation,
    } as const;
    const reader = readers[functionName];
    const required = new Set<string>(requiredKeys);
    mockRequirePermission.mockImplementation(async (permission: string) => {
      if (!required.has(permission)) {
        throw Object.assign(new Error('Forbidden'), { status: 403, permission });
      }
      return new Set(requiredKeys);
    });

    await reader(19);

    expect(mockRequirePermission).toHaveBeenCalledWith(requiredKeys[0]);
    for (const requiredKey of requiredKeys.slice(1)) {
      expect(mockRequirePermission).toHaveBeenCalledWith(requiredKey);
    }
  });

  it.each([
    ['getSubmissionResults', ['submission:read', 'submissionresult:read', 'file:read'], 'submissionresult:read'],
    ['getSubmissionLogs', ['submission:read', 'submissionresult:read'], 'submissionresult:read'],
    ['getSubmissionEvaluation', ['submission:read', 'evaluation:read'], 'evaluation:read'],
  ] as const)('%s rejects a partial reader set before querying', async (functionName, requiredKeys, missingKey) => {
    const readers = {
      getSubmissionResults,
      getSubmissionLogs,
      getSubmissionEvaluation,
    } as const;
    const reader = readers[functionName];
    mockRequirePermission.mockImplementation(async (permission: string) => {
      if (permission === missingKey) {
        throw Object.assign(new Error('Forbidden'), { status: 403, permission });
      }
      return new Set(requiredKeys.filter((key) => key !== missingKey));
    });

    await expect(reader(19)).rejects.toMatchObject({ status: 403, permission: missingKey });
    expect(prisma.submissions.findUnique).not.toHaveBeenCalled();
    expect(prisma.submission_results.findMany).not.toHaveBeenCalled();
    expect(prisma.evaluations.findMany).not.toHaveBeenCalled();
  });

  it('keeps the Results reader inside the results tables', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['submission:read', 'submissionresult:read', 'file:read']));

    await getSubmissionResults(19);

    expect(mockResultsFindMany).toHaveBeenCalledTimes(1);
    expect(mockEvaluationsFindMany).not.toHaveBeenCalled();
    expect(mockFilesFindMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the Logs reader inside the results table', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['submission:read', 'submissionresult:read']));

    await getSubmissionLogs(19);

    expect(mockResultsFindMany).toHaveBeenCalledTimes(1);
    expect(mockEvaluationsFindMany).not.toHaveBeenCalled();
    expect(mockFilesFindMany).not.toHaveBeenCalled();
  });

  it('keeps the Evaluation reader inside the evaluations table', async () => {
    mockRequirePermission.mockResolvedValue(new Set(['submission:read', 'evaluation:read']));

    await getSubmissionEvaluation(19);

    expect(mockEvaluationsFindMany).toHaveBeenCalledTimes(1);
    expect(mockResultsFindMany).not.toHaveBeenCalled();
    expect(mockFilesFindMany).not.toHaveBeenCalled();
  });
});
