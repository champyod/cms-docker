import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  recordAudit: vi.fn(),
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    submissions: { findUnique: (...args: unknown[]) => mocks.findUnique(...args) },
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
  },
}));

import { GET } from '@/app/api/submissions/[id]/files/zip/route';

function zipRequest(): NextRequest {
  return new NextRequest('http://localhost/api/submissions/42/files/zip');
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function allowDownload(): void {
  mocks.verifyApiPermission.mockResolvedValue({
    authorized: true,
    session: { userId: '1', username: 'admin', expiresAt: new Date().toISOString() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  allowDownload();
  mocks.recordAudit.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/submissions/[id]/files/zip', () => {
  it('answers 403 without submission:download and audits nothing', async () => {
    mocks.verifyApiPermission.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(zipRequest(), routeParams('42'));

    expect(response.status).toBe(403);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric submission id before touching the database', async () => {
    const response = await GET(zipRequest(), routeParams('abc'));

    expect(response.status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('reports a missing submission as 404 without auditing', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await GET(zipRequest(), routeParams('42'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('Submission not found');
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('reports a submission without stored files as 404 without auditing', async () => {
    mocks.findUnique.mockResolvedValue({ id: 42 });
    mocks.queryRaw.mockResolvedValue([]);

    const response = await GET(zipRequest(), routeParams('42'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toContain('No stored files');
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses an incomplete archive when a stored blob is missing', async () => {
    mocks.findUnique.mockResolvedValue({ id: 42 });
    mocks.queryRaw.mockResolvedValue([
      { filename: 'sol.py', data: Buffer.from('print(1)') },
      { filename: 'lost.py', data: null },
    ]);

    const response = await GET(zipRequest(), routeParams('42'));

    expect(response.status).toBe(500);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('streams one zip holding every file, then audits the filenames once', async () => {
    mocks.findUnique.mockResolvedValue({ id: 42 });
    mocks.queryRaw.mockResolvedValue([
      { filename: 'sol.py', data: Buffer.from('print(1)') },
      { filename: 'input.txt', data: Buffer.from('3 4') },
    ]);

    const response = await GET(zipRequest(), routeParams('42'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/zip');
    expect(response.headers.get('content-disposition')).toContain('submission-42.zip');

    const archive = await JSZip.loadAsync(await response.arrayBuffer());
    expect(Object.keys(archive.files).sort()).toEqual(['input.txt', 'sol.py']);
    expect(await archive.file('sol.py')?.async('string')).toBe('print(1)');
    expect(await archive.file('input.txt')?.async('string')).toBe('3 4');

    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    const audited = mocks.recordAudit.mock.calls[0][0];
    expect(audited).toMatchObject({
      verb: 'submission:download',
      entity: 'submission',
      entityId: '42',
      result: 'success',
      afterValues: { format: 'zip', fileCount: 2 },
    });
    expect([...audited.afterValues.files].sort()).toEqual(['input.txt', 'sol.py']);
  });

  it('keeps traversal segments and duplicate names out of the archive', async () => {
    mocks.findUnique.mockResolvedValue({ id: 42 });
    mocks.queryRaw.mockResolvedValue([
      { filename: '../escape.py', data: Buffer.from('a') },
      { filename: 'pkg/../pkg/../pkg/main.py', data: Buffer.from('b') },
      { filename: 'pkg/main.py', data: Buffer.from('c') },
    ]);

    const response = await GET(zipRequest(), routeParams('42'));
    const archive = await JSZip.loadAsync(await response.arrayBuffer());
    const names = Object.keys(archive.files).filter((name) => !archive.files[name].dir);

    expect(names).toHaveLength(3);
    for (const name of names) {
      expect(name).not.toContain('..');
      expect(name.startsWith('/')).toBe(false);
    }
    expect(new Set(names).size).toBe(3);

    const audited = mocks.recordAudit.mock.calls[0][0].afterValues.files as string[];
    expect(audited.sort()).toEqual([...names].sort());
  });
});
