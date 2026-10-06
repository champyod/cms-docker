'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { recordAudit } from '@/lib/audit';
import { stripDisallowedFields } from '@/lib/field-permissions';
import {
  findDatasetOrError,
  toSafeActionError,
  type ActionResult,
} from './testcase-support';

type TestcaseRow = Awaited<ReturnType<typeof prisma.testcases.findMany>>[number];

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

export async function getTestcases(datasetId: number): Promise<TestcaseRow[]> {
  await ensurePermission('testcase:list');
  return prisma.testcases.findMany({
    where: { dataset_id: datasetId },
    orderBy: { codename: 'asc' }
  });
}
