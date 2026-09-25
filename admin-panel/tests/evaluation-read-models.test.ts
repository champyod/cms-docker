import { describe, expect, it, vi } from 'vitest';
import {
  getSubmissionEvaluation,
  getSubmissionLogs,
  getSubmissionSummary,
  getSubmissionResults,
} from '@/lib/evaluation-read-models';
import { requirePermission } from '@/lib/server/authorization';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findUnique: vi.fn() },
    submission_results: { findMany: vi.fn() },
    evaluations: { findMany: vi.fn() },
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);

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
  });
});
