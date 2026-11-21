import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPreviousSubmission } from '@/lib/evaluation-read-models';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);
const mockFindUnique = vi.mocked(prisma.submissions.findUnique);
const mockFindFirst = vi.mocked(prisma.submissions.findFirst);

const SUBMISSION_READER = new Set(['submission:read']);
const FILE_READER = new Set(['submission:read', 'file:read']);

const CURRENT = { participation_id: 3, task_id: 5 };
const PREVIOUS = {
  id: 7,
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  language: 'C++17 / g++',
  files: [{ filename: 'sol.cpp', digest: 'digest-prev' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue(SUBMISSION_READER);
  mockFindUnique.mockResolvedValue(CURRENT as never);
  mockFindFirst.mockResolvedValue(PREVIOUS as never);
});

describe('Submission previous read model', () => {
  it('requires submission:read before it reads anything', async () => {
    mockRequirePermission.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(getPreviousSubmission(19)).rejects.toMatchObject({ status: 403 });
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('reads the current submission to learn the participation and task pair', async () => {
    await getPreviousSubmission(19);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 19 },
      select: { participation_id: true, task_id: true },
    });
  });

  it('looks for the latest earlier submission of the same participation and task', async () => {
    await getPreviousSubmission(19);

    expect(mockFindFirst.mock.calls[0][0]).toEqual({
      where: { participation_id: 3, task_id: 5, id: { lt: 19 } },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        timestamp: true,
        language: true,
        files: { select: { filename: true, digest: true }, orderBy: { filename: 'asc' }, take: 1 },
      },
    });
  });

  it('resolves the previous file reference for a reader holding file:read', async () => {
    mockRequirePermission.mockResolvedValue(FILE_READER);

    await expect(getPreviousSubmission(19)).resolves.toEqual({
      submissionId: 7,
      timestamp: '2026-01-01T00:00:00.000Z',
      source: {
        submissionId: 7,
        language: 'C++17 / g++',
        sourceReadable: true,
        filename: 'sol.cpp',
        digest: 'digest-prev',
      },
    });
  });

  it('omits the filename and digest without file:read', async () => {
    const previous = await getPreviousSubmission(19);

    expect(previous?.source).toEqual({ submissionId: 7, language: 'C++17 / g++', sourceReadable: false });
    expect(previous?.source).not.toHaveProperty('digest');
    expect(previous?.source).not.toHaveProperty('filename');
  });

  it('reports a previous submission with no stored file without a source', async () => {
    mockFindFirst.mockResolvedValue({ ...PREVIOUS, files: [] } as never);

    await expect(getPreviousSubmission(19)).resolves.toEqual({
      submissionId: 7,
      timestamp: '2026-01-01T00:00:00.000Z',
      source: null,
    });
  });

  it('reports an unknown current submission as a miss without querying a previous one', async () => {
    mockFindUnique.mockResolvedValue(null as never);

    await expect(getPreviousSubmission(19)).resolves.toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('reports no earlier submission as a miss', async () => {
    mockFindFirst.mockResolvedValue(null as never);

    await expect(getPreviousSubmission(19)).resolves.toBeNull();
  });
});
