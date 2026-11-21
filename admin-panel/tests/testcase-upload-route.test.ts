import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_BULK_TESTCASES, MAX_TESTCASE_FILE_BYTES, MAX_TESTCASE_UPLOAD_BYTES } from '@/lib/testcase-limits';
import { isRequestBodyTooLarge } from '@/lib/testcase-limits';

const mocks = vi.hoisted(() => ({
  verifyApiPermission: vi.fn(),
  datasetFindUnique: vi.fn(),
  testcaseFindUnique: vi.fn(),
  testcaseCreate: vi.fn(),
  storeFile: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/api-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-utils')>('@/lib/api-utils');
  return { ...actual, verifyApiPermission: mocks.verifyApiPermission };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    datasets: { findUnique: mocks.datasetFindUnique },
    testcases: { findUnique: mocks.testcaseFindUnique, create: mocks.testcaseCreate },
  },
}));
vi.mock('@/lib/permissions', () => ({
  getPermissions: vi.fn(async () => new Set(['testcase:create'])),
}));
vi.mock('@/lib/field-permissions', () => ({
  stripDisallowedFields: (_table: string, fields: Record<string, unknown>) => fields,
}));
vi.mock('@/lib/fsobjects', () => ({ storeFile: mocks.storeFile }));
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.recordAudit }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST as uploadRoute } from '@/app/api/testcases/route';

const asFile = (bytes: Uint8Array, name: string): File => new File([new Uint8Array(bytes)], name);

interface PairDraft {
  codename?: string;
  input?: File;
  output?: File;
}

function buildFormData(pairs: PairDraft[], datasetId = '3'): FormData {
  const formData = new FormData();
  formData.append('datasetId', datasetId);
  formData.append('count', String(pairs.length));
  pairs.forEach((pair, index) => {
    if (pair.codename !== undefined) formData.append(`codename-${index}`, pair.codename);
    if (pair.input) formData.append(`input-${index}`, pair.input);
    if (pair.output) formData.append(`output-${index}`, pair.output);
  });
  return formData;
}

const filePair = (codename: string, size = 4): PairDraft => ({
  codename,
  input: asFile(new Uint8Array(size), `${codename}.in`),
  output: asFile(new Uint8Array(size), `${codename}.out`),
});

async function postUpload(formData: FormData, headers?: Record<string, string>): Promise<Response> {
  return uploadRoute(new NextRequest('http://localhost/api/testcases', { method: 'POST', body: formData, headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyApiPermission.mockResolvedValue({ authorized: true, session: { userId: '1' } });
  mocks.datasetFindUnique.mockResolvedValue({ id: 3 });
  mocks.testcaseFindUnique.mockResolvedValue(null);
  mocks.testcaseCreate.mockImplementation(async (args: { data: { codename: string } }) => ({ id: 10, ...args.data }));
  mocks.storeFile.mockImplementation(async (data: Buffer) => `digest-${data.length}`);
  mocks.recordAudit.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('POST /api/testcases validation', () => {
  it('rejects a non-integer dataset id', async () => {
    const response = await postUpload(buildFormData([filePair('a')], 'NaN'));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Invalid dataset');
  });

  it('returns not found for a missing dataset', async () => {
    mocks.datasetFindUnique.mockResolvedValue(null);
    const response = await postUpload(buildFormData([filePair('a')]));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Dataset not found');
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });

  it('rejects a codename outside the safe charset', async () => {
    const response = await postUpload(buildFormData([filePair('../../etc/passwd')]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid codename');
    expect(mocks.storeFile).not.toHaveBeenCalled();
    expect(mocks.testcaseCreate).not.toHaveBeenCalled();
  });

  it('rejects a codename above the length limit', async () => {
    const response = await postUpload(buildFormData([filePair('a'.repeat(256))]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid codename');
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });

  it('rejects an empty list', async () => {
    const response = await postUpload(buildFormData([]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('No testcases provided');
  });

  it('rejects more than the per-upload limit', async () => {
    const many = Array.from({ length: MAX_BULK_TESTCASES + 1 }, () => ({ codename: 'x', input: asFile(new Uint8Array(1), 'x.in'), output: asFile(new Uint8Array(1), 'x.out') }));
    const response = await postUpload(buildFormData(many));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(String(MAX_BULK_TESTCASES));
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });

  it('rejects files over the per-file limit before reading them', async () => {
    const draft = {
      codename: 'big',
      input: asFile(new Uint8Array(MAX_TESTCASE_FILE_BYTES + 1), 'big.in'),
      output: asFile(new Uint8Array(4), 'big.out'),
    };
    const response = await postUpload(buildFormData([draft]));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('exceeds the 2 MB per-file limit');
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });

  it('rejects a batch over the total limit', async () => {
    const pairSideBytes = MAX_TESTCASE_FILE_BYTES;
    const pairCount = Math.floor(MAX_TESTCASE_UPLOAD_BYTES / (2 * pairSideBytes)) + 1;
    const drafts = Array.from({ length: pairCount }, (_unused, index) => ({
      codename: `t${index}`,
      input: asFile(new Uint8Array(pairSideBytes), `t${index}.in`),
      output: asFile(new Uint8Array(pairSideBytes), `t${index}.out`),
    }));
    const response = await postUpload(buildFormData(drafts));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('total limit');
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });

  it('rejects a pair without a codename, a pair without files, and an empty file', async () => {
    const noCodename = buildFormData([{ input: asFile(new Uint8Array(2), 'a.in'), output: asFile(new Uint8Array(2), 'a.out') }]);
    const missing = await postUpload(noCodename);
    expect(missing.status).toBe(400);

    const noFiles = buildFormData([{ codename: 'a' }]);
    const missingFiles = await postUpload(noFiles);
    expect(missingFiles.status).toBe(400);
    expect((await missingFiles.json()).error).toContain('Missing input or output file');

    const empty = buildFormData([{ codename: 'a', input: asFile(new Uint8Array(0), 'a.in'), output: asFile(new Uint8Array(2), 'a.out') }]);
    const emptyFile = await postUpload(empty);
    expect(emptyFile.status).toBe(400);
    expect((await emptyFile.json()).error).toContain('Empty file');
  });

  it('refuses an oversized declared body before parsing it', async () => {
    const oversized = String(MAX_TESTCASE_UPLOAD_BYTES + 2 * 1024 * 1024);
    const response = await postUpload(new FormData(), { 'content-length': oversized });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('total limit');
    expect(mocks.datasetFindUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/testcases persistence', () => {
  it('creates new rows, skips duplicates, and audits counts', async () => {
    mocks.testcaseFindUnique.mockImplementation(async (args: { where: { dataset_id_codename: { codename: string } } }) =>
      args.where.dataset_id_codename.codename === 'dup' ? { id: 9 } : null,
    );

    const response = await postUpload(buildFormData([filePair('fresh'), filePair('dup')]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.details).toEqual([
      { codename: 'fresh', status: 'created' },
      { codename: 'dup', status: 'skipped' },
    ]);
    expect(mocks.storeFile).toHaveBeenCalledTimes(2);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit.mock.calls[0][0]).toMatchObject({
      verb: 'testcase:create',
      afterValues: { datasetId: 3, created: 1, skipped: 1, failed: 0 },
      result: 'success',
    });
  });

  it('skips a race duplicate whose message uses Prisma capital casing', async () => {
    mocks.testcaseCreate.mockRejectedValue(new Error('Unique constraint failed on the fields (`codename`)'));
    const response = await postUpload(buildFormData([filePair('a')]));
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.details).toEqual([{ codename: 'a', status: 'skipped' }]);
    expect(mocks.recordAudit.mock.calls[0][0]).toMatchObject({ result: 'success' });
  });

  it('maps unknown database errors to a generic message and audits a failure', async () => {
    mocks.testcaseCreate.mockRejectedValue(new Error('relation "internal_schema" does not exist'));
    const response = await postUpload(buildFormData([filePair('a')]));
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error).toBe('1 of 1 testcases failed to save');
    expect(body.error).not.toContain('internal_schema');
    expect(body.details).toEqual([
      { codename: 'a', status: 'failed', error: 'Upload failed. Contact an administrator if this persists.' },
    ]);
    expect(mocks.recordAudit.mock.calls[0][0]).toMatchObject({ result: 'failure' });
  });

  it('denies the upload without a session permission', async () => {
    mocks.verifyApiPermission.mockResolvedValue({ authorized: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) });
    const response = await postUpload(buildFormData([filePair('a')]));
    expect(response.status).toBe(403);
    expect(mocks.storeFile).not.toHaveBeenCalled();
  });
});

describe('isRequestBodyTooLarge', () => {
  it('accepts a missing header, deferring to post-parse validation', () => {
    expect(isRequestBodyTooLarge(null)).toBe(false);
  });

  it('accepts a body within the limit including multipart overhead', () => {
    expect(isRequestBodyTooLarge(String(MAX_TESTCASE_UPLOAD_BYTES))).toBe(false);
  });

  it('rejects a body above the limit plus overhead', () => {
    expect(isRequestBodyTooLarge(String(MAX_TESTCASE_UPLOAD_BYTES + 2 * 1024 * 1024))).toBe(true);
  });

  it('defers on an unparseable header', () => {
    expect(isRequestBodyTooLarge('not-a-number')).toBe(false);
  });
});
