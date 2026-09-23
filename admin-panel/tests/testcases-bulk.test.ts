import { beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = {
  dataset: true as boolean | null,
  existing: new Set<string>(),
  createError: null as Error | null,
};

const audits: { verb: string; afterValues?: unknown; result?: string }[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/permissions', () => ({
  ensurePermission: vi.fn(async () => undefined),
  getPermissions: vi.fn(async () => new Set(['testcase:create'])),
}));
vi.mock('@/lib/field-permissions', () => ({
  stripDisallowedFields: (_table: string, fields: Record<string, unknown>) => fields,
}));
vi.mock('@/lib/audit', () => ({
  recordAudit: vi.fn(async (entry: { verb: string; afterValues?: unknown; result?: string }) => {
    audits.push(entry);
  }),
}));
vi.mock('@/lib/fsobjects', () => ({
  storeFile: vi.fn(async (data: Buffer) => `digest-${data.length}`),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    datasets: {
      findUnique: async () => (stubs.dataset ? { id: 3 } : null),
    },
    testcases: {
      findUnique: async (args: { where: { dataset_id_codename: { codename: string } } }) =>
        stubs.existing.has(args.where.dataset_id_codename.codename) ? { id: 9 } : null,
      create: async (args: { data: { codename: string } }) => {
        if (stubs.createError) throw stubs.createError;
        return { id: 10, ...args.data };
      },
    },
  },
}));

function item(codename: string, size = 4): { codename: string; inputBase64: string; outputBase64: string; isPublic: boolean } {
  const base64 = Buffer.from('x'.repeat(size)).toString('base64');
  return { codename, inputBase64: base64, outputBase64: base64, isPublic: false };
}

beforeEach(() => {
  stubs.dataset = true;
  stubs.existing = new Set<string>();
  stubs.createError = null;
  audits.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('batchUploadTestcases', () => {
  it('rejects a non-integer dataset id', async () => {
    const { batchUploadTestcases } = await import('@/app/actions/testcases');
    expect(await batchUploadTestcases(Number.NaN, [item('a')])).toEqual({
      success: false,
      error: 'Invalid dataset',
    });
  });

  it('returns not found for a missing dataset', async () => {
    stubs.dataset = false;
    const { batchUploadTestcases } = await import('@/app/actions/testcases');
    expect(await batchUploadTestcases(999, [item('a')])).toEqual({
      success: false,
      error: 'Dataset not found',
    });
  });

  it('rejects an empty list', async () => {
    const { batchUploadTestcases } = await import('@/app/actions/testcases');
    expect(await batchUploadTestcases(3, [])).toEqual({
      success: false,
      error: 'No testcases provided',
    });
  });

  it('rejects more than the per-upload limit', async () => {
    const { batchUploadTestcases, MAX_BULK_TESTCASES } = await import('@/app/actions/testcases');
    const many = Array.from({ length: MAX_BULK_TESTCASES + 1 }, (_, i) => item(`t${i}`));
    const result = await batchUploadTestcases(3, many);
    expect(result.success).toBe(false);
    expect(result.error).toContain(String(MAX_BULK_TESTCASES));
  });

  it('rejects files over the per-file limit', async () => {
    const { batchUploadTestcases, MAX_TESTCASE_FILE_BYTES } = await import('@/app/actions/testcases');
    const result = await batchUploadTestcases(3, [item('big', MAX_TESTCASE_FILE_BYTES + 1)]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds the 2 MB per-file limit');
  });

  it('creates new rows, skips duplicates, and audits counts', async () => {
    stubs.existing = new Set(['dup']);
    const { batchUploadTestcases } = await import('@/app/actions/testcases');
    const result = await batchUploadTestcases(3, [item('fresh'), item('dup')]);
    expect(result.success).toBe(true);
    expect(result.details).toEqual([
      { codename: 'fresh', status: 'created' },
      { codename: 'dup', status: 'skipped' },
    ]);
    expect(audits).toHaveLength(1);
    expect(audits[0].verb).toBe('testcase:create');
    expect(audits[0].afterValues).toEqual({ datasetId: 3, created: 1, skipped: 1, failed: 0 });
  });

  it('maps unknown database errors to a generic message', async () => {
    stubs.createError = new Error('relation "internal_schema" does not exist');
    const { batchUploadTestcases } = await import('@/app/actions/testcases');
    const result = await batchUploadTestcases(3, [item('a')]);
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('internal_schema');
    expect(result.details).toEqual([
      { codename: 'a', status: 'failed', error: 'Upload failed. Contact an administrator if this persists.' },
    ]);
  });
});
