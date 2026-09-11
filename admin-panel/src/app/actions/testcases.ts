'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { storeFile } from '@/lib/fsobjects';

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

export async function addTestcase(datasetId: number, data: {
  codename: string;
  inputDigest: string;
  outputDigest: string;
  isPublic: boolean;
}): Promise<ActionResult> {
  await ensurePermission('testcase:create');
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
    await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename,
        input,
        output,
        public: isPub ?? false,
      }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    if (e.message?.includes('unique constraint')) {
      return { success: false, error: `Testcase with codename "${data.codename}" already exists` };
    }
    return { success: false, error: e.message };
  }
}

export async function deleteTestcase(testcaseId: number): Promise<ActionResult> {
  await ensurePermission('testcase:delete');

  try {
    await prisma.testcases.delete({
      where: { id: testcaseId }
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
    await prisma.testcases.updateMany({
      where: { id: { in: testcaseIds } },
      data: { public: allowed.public }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

async function createTestcaseSafely(datasetId: number, tc: TestcaseInput): Promise<void> {
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
  } catch (error) {
    const e = error as { message?: string };
    if (!e.message?.includes('unique constraint')) throw error;
    console.warn(`Testcase ${tc.codename} already exists, skipping.`);
  }
}

export async function batchUploadTestcases(datasetId: number, testcases: TestcaseInput[]): Promise<ActionResult> {
  await ensurePermission('testcase:update');

  try {
    for (const tc of testcases) {
      await createTestcaseSafely(datasetId, tc);
    }
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

export async function getTestcases(datasetId: number): Promise<TestcaseRow[]> {
  await ensurePermission('testcase:list');
  return prisma.testcases.findMany({
    where: { dataset_id: datasetId },
    orderBy: { codename: 'asc' }
  });
}
