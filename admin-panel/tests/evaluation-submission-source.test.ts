import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSubmissionSource } from '@/lib/evaluation-read-models';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/server/authorization';

vi.mock('@/lib/server/authorization', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findUnique: vi.fn() },
  },
}));

const mockRequirePermission = vi.mocked(requirePermission);
const mockFindUnique = vi.mocked(prisma.submissions.findUnique);

const SUBMISSION_READER = new Set(['submission:read']);
const FILE_READER = new Set(['submission:read', 'file:read']);

const SOURCE_ROW = {
  language: 'C++17 / g++',
  files: [{ filename: 'sol.cpp', digest: 'digest-1' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue(SUBMISSION_READER);
  mockFindUnique.mockResolvedValue(SOURCE_ROW as never);
});

describe('Submission source read model', () => {
  it('requires submission:read before it reads anything', async () => {
    mockRequirePermission.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));

    await expect(getSubmissionSource(19)).rejects.toMatchObject({ status: 403 });
    expect(mockRequirePermission).toHaveBeenCalledWith('submission:read');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('reads only the submission language and its first file for the reader', async () => {
    mockRequirePermission.mockResolvedValue(FILE_READER);

    await getSubmissionSource(19);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 19 },
      select: {
        language: true,
        files: { select: { filename: true, digest: true }, orderBy: { filename: 'asc' }, take: 1 },
      },
    });
  });

  it('resolves the file reference for a reader holding file:read', async () => {
    mockRequirePermission.mockResolvedValue(FILE_READER);

    await expect(getSubmissionSource(19)).resolves.toEqual({
      submissionId: 19,
      language: 'C++17 / g++',
      sourceReadable: true,
      filename: 'sol.cpp',
      digest: 'digest-1',
    });
  });

  it('aims the viewer at no digest without file:read', async () => {
    const source = await getSubmissionSource(19);

    expect(source).toEqual({ submissionId: 19, language: 'C++17 / g++', sourceReadable: false });
    expect(source).not.toHaveProperty('digest');
    expect(source).not.toHaveProperty('filename');
  });

  it('reports a submission with no stored file as a miss', async () => {
    mockRequirePermission.mockResolvedValue(FILE_READER);
    mockFindUnique.mockResolvedValue({ language: 'cpp', files: [] } as never);

    await expect(getSubmissionSource(19)).resolves.toBeNull();
  });

  it('reports an unknown submission as a miss', async () => {
    mockFindUnique.mockResolvedValue(null as never);

    await expect(getSubmissionSource(19)).resolves.toBeNull();
  });
});
