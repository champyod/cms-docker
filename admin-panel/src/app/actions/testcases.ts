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

// Store file in fsobjects table (CMS file storage system)
import crypto from 'crypto';

async function storeFile(data: Buffer): Promise<string> {
  const digest = crypto.createHash('sha256').update(data).digest('hex');

  // Check if file already exists
  const existing = await prisma.$queryRaw<any[]>`
    SELECT digest FROM fsobjects WHERE digest = ${digest}
  `;

  if (existing.length === 0) {
    // Store the file using PostgreSQL Large Object
    // First create a large object and get the OID
    const result = await prisma.$queryRaw<any[]>`
      SELECT lo_from_bytea(0, ${data}::bytea) as lob_oid
    `;
    const lobOid = result[0].lob_oid;

    // Insert into fsobjects table
    await prisma.$executeRaw`
      INSERT INTO fsobjects (digest, lob_oid, description)
      VALUES (${digest}, ${lobOid}, 'Uploaded via Admin Panel')
    `;
  }

  return digest;
}

// Batch upload testcases
export async function batchUploadTestcases(datasetId: number, testcases: {
  codename: string;
  inputBase64: string;
  outputBase64: string;
  isPublic: boolean;
}[]) {
  try {
    for (const tc of testcases) {
      // Decode and store input
      const inputBuffer = Buffer.from(tc.inputBase64, 'base64');
      const inputDigest = await storeFile(inputBuffer);

      // Decode and store output
      const outputBuffer = Buffer.from(tc.outputBase64, 'base64');
      const outputDigest = await storeFile(outputBuffer);

      try {
        await prisma.testcases.create({
          data: {
            dataset_id: datasetId,
            codename: tc.codename,
            input: inputDigest,
            output: outputDigest,
            public: tc.isPublic,
          }
        });
      } catch (e: any) {
        if (e.message?.includes('unique constraint')) {
          // Skip duplicates or update? For now just skip logging error
          console.warn(`Testcase ${tc.codename} already exists, skipping.`);
        } else {
          throw e;
        }
      }
    }

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
