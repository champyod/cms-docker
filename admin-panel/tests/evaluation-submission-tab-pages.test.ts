import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/dictionaries/en.json';
import SubmissionEvaluationPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/evaluation/page';
import SubmissionLogsPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/logs/page';
import SubmissionResultsPage from '@/app/[locale]/(authenticated)/evaluation/submissions/[id]/results/page';
import {
  getSubmissionEvaluation,
  getSubmissionLogs,
  getSubmissionResults,
  getSubmissionSummary,
} from '@/lib/evaluation-read-models';
import type { SubmissionSummary } from '@/lib/evaluation-read-model-types';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  redirect: vi.fn((target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); }),
}));

vi.mock('@/lib/server/authorization', () => ({
  requirePermission: vi.fn(),
  AuthorizationError: class AuthorizationError extends Error {
    readonly status: 401 | 403;
    constructor(status: 401 | 403) {
      super(`Unauthorized: ${status}`);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/evaluation-read-models', () => ({
  getSubmissionSummary: vi.fn(),
  getSubmissionResults: vi.fn(),
  getSubmissionLogs: vi.fn(),
  getSubmissionEvaluation: vi.fn(),
}));

vi.mock('@/components/submissions/SubmissionResultsTab', () => ({
  SubmissionResultsTab: () => null,
}));

vi.mock('@/components/submissions/SubmissionLogsTab', () => ({
  SubmissionLogsTab: () => null,
}));

vi.mock('@/components/submissions/SubmissionEvaluationTab', () => ({
  SubmissionEvaluationTab: () => null,
}));

vi.mock('@/i18n', () => ({ getDictionary: vi.fn(async () => en) }));

const COMPLETE_RECORD_READER: readonly string[] = [
  'submission:read',
  'submissionresult:read',
  'file:read',
  'evaluation:read',
];

const SUMMARY_STUB: SubmissionSummary = {
  id: 19,
  timestamp: '2026-02-03T04:05:06.000Z',
  language: 'cpp',
  comment: '',
  official: false,
  user: null,
  contest: null,
  task: null,
  capabilities: {
    canUpdate: true,
    canRecompute: true,
    canDownload: true,
    canAssignLane: true,
    canMoveLane: true,
  },
};

function grant(keys: readonly string[]): void {
  vi.mocked(requirePermission).mockImplementation(async (permission: string) => {
    if (!keys.includes(permission)) throw new AuthorizationError(403);
    return new Set(keys);
  });
}

beforeEach(() => {
  vi.mocked(getSubmissionResults).mockReset();
  vi.mocked(getSubmissionLogs).mockReset();
  vi.mocked(getSubmissionEvaluation).mockReset();
  vi.mocked(getSubmissionSummary).mockReset();
  vi.mocked(getSubmissionSummary).mockResolvedValue(SUMMARY_STUB);
});

describe('Submission tab page authorization', () => {
  it('reads the Results model and never the Logs or Evaluation readers', async () => {
    grant(COMPLETE_RECORD_READER);
    vi.mocked(getSubmissionResults).mockResolvedValue({ submissionId: 19, results: [], files: [] });

    await SubmissionResultsPage({ params: Promise.resolve({ locale: 'en', id: '19' }) });

    expect(getSubmissionResults).toHaveBeenCalledWith(19);
    expect(getSubmissionLogs).not.toHaveBeenCalled();
    expect(getSubmissionEvaluation).not.toHaveBeenCalled();
  });

  it('reads the Logs model and never the Results or Evaluation readers', async () => {
    grant(COMPLETE_RECORD_READER);
    vi.mocked(getSubmissionLogs).mockResolvedValue({
      submissionId: 19,
      compilationOutcome: null,
      compilationText: [],
      compilationStdout: null,
      compilationStderr: null,
    });

    await SubmissionLogsPage({ params: Promise.resolve({ locale: 'en', id: '19' }) });

    expect(getSubmissionLogs).toHaveBeenCalledWith(19);
    expect(getSubmissionResults).not.toHaveBeenCalled();
    expect(getSubmissionEvaluation).not.toHaveBeenCalled();
  });

  it('reads the Evaluation model and never the Results or Logs readers', async () => {
    grant(COMPLETE_RECORD_READER);
    vi.mocked(getSubmissionEvaluation).mockResolvedValue({ submissionId: 19, evaluations: [] });

    await SubmissionEvaluationPage({ params: Promise.resolve({ locale: 'en', id: '19' }) });

    expect(getSubmissionEvaluation).toHaveBeenCalledWith(19);
    expect(getSubmissionResults).not.toHaveBeenCalled();
    expect(getSubmissionLogs).not.toHaveBeenCalled();
  });

  it.each(['submissionresult:read', 'file:read'])(
    'conceals /results before its reader runs when the caller lacks %s',
    async (missingKey) => {
      grant(COMPLETE_RECORD_READER.filter((key) => key !== missingKey));

      await expect(SubmissionResultsPage({ params: Promise.resolve({ locale: 'en', id: '19' }) }))
        .rejects.toThrow('NEXT_NOT_FOUND');
      expect(getSubmissionResults).not.toHaveBeenCalled();
    },
  );

  it('conceals /logs before its reader runs when the caller lacks submissionresult:read', async () => {
    grant(COMPLETE_RECORD_READER.filter((key) => key !== 'submissionresult:read'));

    await expect(SubmissionLogsPage({ params: Promise.resolve({ locale: 'en', id: '19' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(getSubmissionLogs).not.toHaveBeenCalled();
  });

  it('conceals /evaluation before its reader runs when the caller lacks evaluation:read', async () => {
    grant(COMPLETE_RECORD_READER.filter((key) => key !== 'evaluation:read'));

    await expect(SubmissionEvaluationPage({ params: Promise.resolve({ locale: 'en', id: '19' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(getSubmissionEvaluation).not.toHaveBeenCalled();
  });

  it('rethrows a 401 instead of concealing the tab', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new AuthorizationError(401));

    await expect(SubmissionResultsPage({ params: Promise.resolve({ locale: 'en', id: '19' }) }))
      .rejects.toMatchObject({ status: 401 });
    expect(getSubmissionResults).not.toHaveBeenCalled();
  });
});
