'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { storeFile } from '@/lib/fsobjects';
import { MAX_BULK_TESTCASES, MAX_TESTCASE_FILE_BYTES } from '@/lib/testcase-limits';

interface TestcaseInput {
  codename: string;
  inputBase64: string;
  outputBase64: string;
  isPublic: boolean;
}

interface ActionResult {
  success: boolean;
  error?: string;
}

type TestcaseRow = Awaited<ReturnType<typeof prisma.testcases.findMany>>[number];

/** Error result when the dataset id is invalid or the dataset is missing. */
async function findDatasetOrError(datasetId: number): Promise<ActionResult | null> {
  if (!Number.isInteger(datasetId)) return { success: false, error: 'Invalid dataset' };
  const dataset = await prisma.datasets.findUnique({ where: { id: datasetId }, select: { id: true } });
  if (!dataset) return { success: false, error: 'Dataset not found' };
  return null;
}

/** Client-safe message for an upload failure; unknown errors are logged server-side. */
function toSafeActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (message.startsWith('Insufficient')) return message;
  if (message.includes('Unique constraint') || message.includes('unique constraint')) {
    return 'A testcase with this codename already exists in this dataset';
  }
  if (message.includes('Foreign key constraint') || message.includes('P2003')) {
    return 'Dataset not found';
  }
  console.error('Testcase upload failed', error);
  return 'Upload failed. Contact an administrator if this persists.';
}

export async function addTestcase(datasetId: number, data: {
  codename: string;
  inputDigest: string;
  outputDigest: string;
  isPublic: boolean;
}): Promise<ActionResult> {
  await ensurePermission('testcase:create');
  const datasetError = await findDatasetOrError(datasetId);
  if (datasetError) return datasetError;
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('testcases', {
    codename: data.codename,
    public: data.isPublic,
    input: data.inputDigest,
    output: data.outputDigest,
  }, permissions);
  const { codename, input, output, public: isPub } = allowed;
  if (codename === undefined || input === undefined || output === undefined) {
    return { success: false, error: 'Insufficient field permissions' };
  }

  try {
    const created = await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename,
        input,
        output,
        public: isPub ?? false,
      }
    });
    await recordAudit({
      verb: 'testcase:create',
      entity: 'testcase',
      entityId: String(created.id),
      afterValues: { dataset_id: datasetId, codename, input, output, public: isPub ?? false },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: `Testcase with codename "${data.codename}" already exists` };
    }
    return { success: false, error: toSafeActionError(error) };
  }
}

export async function deleteTestcase(testcaseId: number): Promise<ActionResult> {
  await ensurePermission('testcase:delete');

  const beforeRow = await prisma.testcases.findUnique({ where: { id: testcaseId } });
  try {
    await prisma.testcases.delete({
      where: { id: testcaseId }
    });
    await recordAudit({
      verb: 'testcase:delete',
      entity: 'testcase',
      entityId: String(testcaseId),
      beforeValues: beforeRow ?? undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function toggleTestcasePublic(testcaseId: number): Promise<ActionResult> {
  await ensurePermission('testcase:update');

  try {
    const tc = await prisma.testcases.findUnique({
      where: { id: testcaseId }
    });

    if (!tc) {
      return { success: false, error: 'Testcase not found' };
    }

    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('testcases', { public: !tc.public }, permissions);
    if (allowed.public === undefined) {
      return { success: false, error: 'Insufficient permissions to toggle public' };
    }

    await prisma.testcases.update({
      where: { id: testcaseId },
      data: { public: allowed.public }
    });

    await recordAudit({
      verb: 'testcase:update',
      entity: 'testcase',
      entityId: String(testcaseId),
      afterValues: { public: allowed.public },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function updateTestcasesPublic(testcaseIds: number[], isPublic: boolean): Promise<ActionResult> {
  await ensurePermission('testcase:update');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('testcases', { public: isPublic }, permissions);
  if (allowed.public === undefined) {
    return { success: false, error: 'Insufficient permissions to update public field' };
  }

  try {
    const result = await prisma.testcases.updateMany({
      where: { id: { in: testcaseIds } },
      data: { public: allowed.public }
    });
    await recordAudit({
      verb: 'testcase:update',
      entity: 'testcase',
      afterValues: { testcaseIds, public: allowed.public, count: result.count },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

async function createTestcaseSafely(datasetId: number, tc: TestcaseInput): Promise<'created' | 'skipped'> {
  // Skip codenames that already exist before storing blobs.
  const existing = await prisma.testcases.findUnique({
    where: { dataset_id_codename: { dataset_id: datasetId, codename: tc.codename } },
    select: { id: true },
  });
  if (existing) {
    console.warn(`Testcase ${tc.codename} already exists, skipping.`);
    return 'skipped';
  }

  const inputDigest = await storeFile(Buffer.from(tc.inputBase64, 'base64'));
  const outputDigest = await storeFile(Buffer.from(tc.outputBase64, 'base64'));

  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('testcases', {
    codename: tc.codename,
    public: tc.isPublic,
    input: inputDigest,
    output: outputDigest,
  }, permissions);
  const { codename, input, output, public: isPub } = allowed;
  if (codename === undefined || input === undefined || output === undefined) {
    throw new Error('Insufficient field permissions for testcase creation');
  }

  try {
    await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename,
        input,
        output,
        public: isPub ?? false,
      }
    });
    return 'created';
  } catch (error) {
    const e = error as { message?: string };
    if (!e.message?.includes('unique constraint')) throw error;
    console.warn(`Testcase ${tc.codename} already exists, skipping.`);
    return 'skipped';
  }
}

export interface BulkItemResult {
  codename: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

export interface BulkUploadResult extends ActionResult {
  details?: BulkItemResult[];
}

/** Decoded byte size of one upload item, or null when the payload is malformed. */
function decodedItemSizes(tc: TestcaseInput): { inputBytes: number; outputBytes: number } | null {
  try {
    return {
      inputBytes: Buffer.from(tc.inputBase64, 'base64').length,
      outputBytes: Buffer.from(tc.outputBase64, 'base64').length,
    };
  } catch {
    return null;
  }
}

export async function batchUploadTestcases(datasetId: number, testcases: TestcaseInput[]): Promise<BulkUploadResult> {
  // Bulk create: every row written here is an insert.
  await ensurePermission('testcase:create');

  const datasetError = await findDatasetOrError(datasetId);
  if (datasetError) return datasetError;
  if (!Array.isArray(testcases) || testcases.length === 0) {
    return { success: false, error: 'No testcases provided' };
  }
  if (testcases.length > MAX_BULK_TESTCASES) {
    return { success: false, error: `Too many testcases: limit is ${MAX_BULK_TESTCASES} per upload` };
  }
  for (const tc of testcases) {
    if (typeof tc.codename !== 'string' || tc.codename.length === 0) {
      return { success: false, error: 'Every testcase needs a codename' };
    }
    const sizes = decodedItemSizes(tc);
    if (!sizes) return { success: false, error: `Testcase "${tc.codename}" has invalid file data` };
    if (sizes.inputBytes > MAX_TESTCASE_FILE_BYTES || sizes.outputBytes > MAX_TESTCASE_FILE_BYTES) {
      return { success: false, error: `Testcase "${tc.codename}" exceeds the 2 MB per-file limit` };
    }
  }

  const details: BulkItemResult[] = [];
  for (const tc of testcases) {
    try {
      details.push({ codename: tc.codename, status: await createTestcaseSafely(datasetId, tc) });
    } catch (error) {
      details.push({ codename: tc.codename, status: 'failed', error: toSafeActionError(error) });
    }
  }
  const created = details.filter((d) => d.status === 'created').length;
  const skipped = details.filter((d) => d.status === 'skipped').length;
  const failed = details.filter((d) => d.status === 'failed');
  await recordAudit({
    verb: 'testcase:create',
    entity: 'testcase',
    afterValues: { datasetId, created, skipped, failed: failed.length },
    result: failed.length === 0 ? 'success' : 'failure',
  });
  revalidatePath('/[locale]/tasks');
  if (failed.length > 0) {
    return { success: false, error: `${failed.length} of ${details.length} testcases failed to save`, details };
  }
  return { success: true, details };
}

export async function getTestcases(datasetId: number): Promise<TestcaseRow[]> {
  await ensurePermission('testcase:list');
  return prisma.testcases.findMany({
    where: { dataset_id: datasetId },
    orderBy: { codename: 'asc' }
  });
}
