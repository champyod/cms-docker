import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  toSubmissionEvaluationRow,
  toSubmissionFileRow,
  toSubmissionLogRow,
  toSubmissionResultRow,
} from '@/lib/evaluation-read-model-projections';
import { getFieldAccess, type FieldAccessTable } from '@/lib/field-permissions';
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

const RESULT_ROW = {
  dataset_id: 1,
  compilation_outcome: 'ok',
  evaluation_outcome: 'ok',
  compilation_time: 12.5,
  compilation_memory: BigInt(3145728),
  score: 80,
  public_score: 60,
  scored_at: new Date('2026-02-03T04:05:06.000Z'),
} as const;

const RESULT_READER = new Set(['submission:read', 'submissionresult:read', 'file:read']);
const PARTIAL_READER = new Set(['submission:read', 'file:read']);
const RESULT_ACCESS = getFieldAccess('submission_results', RESULT_READER);
const PARTIAL_ACCESS = getFieldAccess('submission_results', PARTIAL_READER);

describe('Evaluation result field filtering', () => {
  it('reads every projected field for a caller holding submissionresult:read', () => {
    const row = toSubmissionResultRow(RESULT_ROW, RESULT_ACCESS);

    expect(row).toMatchObject({
      datasetId: 1,
      compilationOutcome: 'ok',
      evaluationOutcome: 'ok',
      compilationTime: 12.5,
      score: 80,
      publicScore: 60,
      scoredAt: '2026-02-03T04:05:06.000Z',
    });
  });

  it.each([
    'compilationTime',
    'scoredAt',
    'compilationMemoryBytes',
  ] as const)('nulls %s when the projection strips its column', (modelField) => {
    const row = toSubmissionResultRow(RESULT_ROW, PARTIAL_ACCESS);

    expect(row[modelField]).toBeNull();
  });

  it('keeps only the identity column a partial reader may not read out of the payload', () => {
    const row = toSubmissionResultRow(RESULT_ROW, PARTIAL_ACCESS);

    expect(row.datasetId).toBe(1);
    expect(row.compilationOutcome).toBeNull();
    expect(row.evaluationOutcome).toBeNull();
    expect(row.score).toBeNull();
    expect(row.publicScore).toBeNull();
  });

  it('serializes the BigInt memory column as a byte count', () => {
    expect(toSubmissionResultRow(RESULT_ROW, RESULT_ACCESS).compilationMemoryBytes).toBe(3145728);
  });

  it('reports a null memory column as null', () => {
    const row = toSubmissionResultRow({ ...RESULT_ROW, compilation_memory: null }, RESULT_ACCESS);

    expect(row.compilationMemoryBytes).toBeNull();
  });

  it('refuses to round a memory column past the safe integer range', () => {
    const row = toSubmissionResultRow({ ...RESULT_ROW, compilation_memory: BigInt(2) ** BigInt(70) }, RESULT_ACCESS);

    expect(row.compilationMemoryBytes).toBeNull();
  });

  it('reads every projected column for a caller holding all:all', () => {
    const row = toSubmissionResultRow(RESULT_ROW, getFieldAccess('submission_results', new Set(['all:all'])));

    expect(row).toMatchObject({ compilationOutcome: 'ok', score: 80, scoredAt: '2026-02-03T04:05:06.000Z' });
  });
});

const LOG_ROW = {
  compilation_outcome: 'ok',
  compilation_text: ['warning: unused'],
  compilation_stdout: 'out',
  compilation_stderr: 'err',
} as const;

const FILE_ROW = { id: 5, filename: 'a.cpp', digest: 'abc123' } as const;

const EVALUATION_ROW = {
  id: 7,
  dataset_id: 1,
  testcase_id: 2,
  outcome: 'correct',
  text: ['ok'],
  execution_time: 0.5,
  execution_memory: BigInt(1048576),
  codename: 'test-2',
} as const;

const LOG_READER = new Set(['submission:read', 'submissionresult:read']);
const FILE_READER = new Set(['submission:read', 'file:read']);
const EVALUATION_READER = new Set(['submission:read', 'evaluation:read']);

describe('Evaluation file, log and evaluation field filtering', () => {
  it.each([
    ['toSubmissionLogRow', () => toSubmissionLogRow(LOG_ROW, getFieldAccess('submission_results', LOG_READER)), { compilationOutcome: 'ok', compilationText: ['warning: unused'], compilationStdout: 'out', compilationStderr: 'err' }],
    ['toSubmissionLogRow without submissionresult:read', () => toSubmissionLogRow(LOG_ROW, getFieldAccess('submission_results', FILE_READER)), { compilationOutcome: null, compilationText: [], compilationStdout: null, compilationStderr: null }],
    ['toSubmissionFileRow', () => toSubmissionFileRow(FILE_ROW, getFieldAccess('files', FILE_READER)), { filename: 'a.cpp', digest: 'abc123' }],
    ['toSubmissionFileRow without file:read', () => toSubmissionFileRow(FILE_ROW, getFieldAccess('files', LOG_READER)), { filename: '', digest: '' }],
    ['toSubmissionEvaluationRow', () => toSubmissionEvaluationRow(EVALUATION_ROW, getFieldAccess('evaluations', EVALUATION_READER)), { outcome: 'correct', text: ['ok'], executionTime: 0.5, executionMemory: '1048576' }],
    ['toSubmissionEvaluationRow without evaluation:read', () => toSubmissionEvaluationRow(EVALUATION_ROW, getFieldAccess('evaluations', LOG_READER)), { outcome: null, text: [], executionTime: null, executionMemory: null }],
  ])('%s projects only the columns the caller may read', (_name, project, expected) => {
    expect(project()).toMatchObject(expected);
  });

  it('keeps the identity columns a partial reader may not read out of the payload', () => {
    const file = toSubmissionFileRow(FILE_ROW, getFieldAccess('files', LOG_READER));
    const evaluation = toSubmissionEvaluationRow(EVALUATION_ROW, getFieldAccess('evaluations', LOG_READER));

    expect(file).toEqual({ id: 5, filename: '', digest: '' });
    expect(evaluation).toMatchObject({ id: 7, datasetId: 1, testcaseId: 2, testcaseName: 'test-2' });
  });
});

// Why: the brand is the whole point — an unbranded table made the files projection
// accept the results table, so this stops compiling the moment the brand is dropped.
type IsExactly<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
const tablesAreNotInterchangeable: IsExactly<FieldAccessTable<'files'>, FieldAccessTable<'submission_results'>> = false;

describe('Field access table branding', () => {
  it('keeps one entity access table from standing in for another', () => {
    expect(tablesAreNotInterchangeable).toBe(false);
  });

  it('brands a table without changing what the table enumerates', () => {
    const access = getFieldAccess('files', FILE_READER);

    expect(Object.keys(access)).toEqual(['id', 'submission_id', 'filename', 'digest']);
  });
});
