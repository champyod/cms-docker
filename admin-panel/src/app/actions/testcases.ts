'use server'

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Add a single testcase
export async function addTestcase(datasetId: number, data: {
  codename: string;
  inputDigest: string;
  outputDigest: string;
  isPublic: boolean;
}) {
  try {
    await prisma.testcases.create({
      data: {
        dataset_id: datasetId,
        codename: data.codename,
        input: data.inputDigest,
        output: data.outputDigest,
        public: data.isPublic,
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

// Delete a testcase
export async function deleteTestcase(testcaseId: number) {
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

// Toggle testcase public flag
export async function toggleTestcasePublic(testcaseId: number) {
  try {
    const tc = await prisma.testcases.findUnique({
      where: { id: testcaseId }
    });
    
    if (!tc) {
      return { success: false, error: 'Testcase not found' };
    }
    
    await prisma.testcases.update({
      where: { id: testcaseId },
      data: { public: !tc.public }
    });
    
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Update testcase public status in bulk
export async function updateTestcasesPublic(testcaseIds: number[], isPublic: boolean) {
  try {
    await prisma.testcases.updateMany({
      where: { id: { in: testcaseIds } },
      data: { public: isPublic }
    });
    revalidatePath('/[locale]/tasks');
    return { success: true };
  } catch (error) {
    const e = error as Error;
    return { success: false, error: e.message };
  }
}

// Get all testcases for a dataset
export async function getTestcases(datasetId: number) {
  return prisma.testcases.findMany({
    where: { dataset_id: datasetId },
    orderBy: { codename: 'asc' }
  });
}
