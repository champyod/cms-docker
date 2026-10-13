import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as getTestcaseDetail } from '@/app/api/submissions/[id]/testcase/[testcaseId]/route';
import { getSession } from '@/lib/auth';
import { getSubmissionTestcaseDetail } from '@/lib/evaluation-read-models';
import { getFreshPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ getFreshPermissions: vi.fn() }));
vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    evaluations: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const mockGetSession = vi.mocked(getSession);
const mockGetFreshPermissions = vi.mocked(getFreshPermissions);
const mockRequirePermission = vi.mocked(requirePermission);
const mockFindFirst = vi.mocked(prisma.evaluations.findFirst);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);

const SUBMISSION_READER = new Set(['submission:read']);
const TESTCASE_READER = new Set(['submission:read', 'testcase:read']);
const TESTCASE_PARAMS = { params: Promise.resolve({ id: '19', testcaseId: '2' }) };

const TESTCASE_ROW = {
  testcases: { codename: 'test-2', input: 'in-digest', output: 'out-digest' },
};

function request(): NextRequest {
  return new NextRequest('http://localhost/api/submissions/19/testcase/2');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ userId: '1', username: 'admin', expiresAt: '2099-01-01' });
  mockGetFreshPermissions.mockResolvedValue(TESTCASE_READER);
  mockRequirePermission.mockResolvedValue(TESTCASE_READER);
  mockFindFirst.mockResolvedValue(null as never);
  mockQueryRaw.mockResolvedValue([] as never);
});

describe('Submission testcase detail read model', () => {
  it('requires submission:read before it reads anything', async () => {
    mockRequirePermission.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(getSubmissionTestcaseDetail(19, 2)).rejects.toMatchObject({ status: 403 });
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('misses when the submission has no evaluation for that testcase', async () => {
    mockFindFirst.mockResolvedValue(null as never);

    await expect(getSubmissionTestcaseDetail(19, 2)).resolves.toBeNull();
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { submission_id: 19, testcase_id: 2 },
      select: { testcases: { select: { codename: true, input: true, output: true } } },
    });
  });

  it('resolves the input and expected-output digests for a reader holding testcase:read', async () => {
    mockFindFirst.mockResolvedValue(TESTCASE_ROW as never);
    mockQueryRaw
      .mockResolvedValueOnce([{ data: Buffer.from('1 2\n') }] as never)
      .mockResolvedValueOnce([{ data: Buffer.from('3\n') }] as never);

    const detail = await getSubmissionTestcaseDetail(19, 2);

    expect(detail).toEqual({
      submissionId: 19,
      testcaseId: 2,
      testcaseName: 'test-2',
      input: '1 2\n',
      expectedOutput: '3\n',
      output: null,
      testcaseReadable: true,
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  it('reports an input or output digest with no stored object as null', async () => {
    mockFindFirst.mockResolvedValue(TESTCASE_ROW as never);

    const detail = await getSubmissionTestcaseDetail(19, 2);

    expect(detail).toMatchObject({ testcaseReadable: true, input: null, expectedOutput: null });
  });

  it('omits the input and expected output without testcase:read', async () => {
    mockRequirePermission.mockResolvedValue(SUBMISSION_READER);
    mockFindFirst.mockResolvedValue(TESTCASE_ROW as never);

    const detail = await getSubmissionTestcaseDetail(19, 2);

    expect(detail).toEqual({
      submissionId: 19,
      testcaseId: 2,
      testcaseName: 'test-2',
      output: null,
      testcaseReadable: false,
    });
    expect(detail).not.toHaveProperty('input');
    expect(detail).not.toHaveProperty('expectedOutput');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

describe('Submission testcase detail route', () => {
  it('returns 401 when no session exists', async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await getTestcaseDetail(request(), TESTCASE_PARAMS);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 for an authenticated caller without submission:read', async () => {
    mockGetFreshPermissions.mockResolvedValue(new Set());

    const response = await getTestcaseDetail(request(), TESTCASE_PARAMS);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden: Missing submission:read permission' });
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric submission or testcase id', async () => {
    const response = await getTestcaseDetail(request(), {
      params: Promise.resolve({ id: '19', testcaseId: 'abc' }),
    });

    expect(response.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the testcase is not evaluated for this submission', async () => {
    mockFindFirst.mockResolvedValue(null as never);

    const response = await getTestcaseDetail(request(), TESTCASE_PARAMS);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Testcase not found for this submission' });
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { submission_id: 19, testcase_id: 2 },
    }));
  });

  it('returns the testcase bytes for a caller holding testcase:read', async () => {
    mockFindFirst.mockResolvedValue(TESTCASE_ROW as never);
    mockQueryRaw
      .mockResolvedValueOnce([{ data: Buffer.from('1 2\n') }] as never)
      .mockResolvedValueOnce([{ data: Buffer.from('3\n') }] as never);

    const response = await getTestcaseDetail(request(), TESTCASE_PARAMS);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      submissionId: 19,
      testcaseId: 2,
      testcaseName: 'test-2',
      input: '1 2\n',
      expectedOutput: '3\n',
      output: null,
      testcaseReadable: true,
    });
  });

  it('sends no testcase bytes to a caller without testcase:read', async () => {
    mockRequirePermission.mockResolvedValue(SUBMISSION_READER);
    mockFindFirst.mockResolvedValue(TESTCASE_ROW as never);

    const response = await getTestcaseDetail(request(), TESTCASE_PARAMS);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      submissionId: 19,
      testcaseId: 2,
      testcaseName: 'test-2',
      output: null,
      testcaseReadable: false,
    });
    expect(payload).not.toHaveProperty('input');
    expect(payload).not.toHaveProperty('expectedOutput');
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});
