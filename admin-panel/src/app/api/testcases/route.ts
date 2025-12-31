import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';

async function storeFile(data: Buffer): Promise<string> {
  const digest = crypto.createHash('sha256').update(data).digest('hex');

  const existing = await prisma.$queryRaw<any[]>`
    SELECT digest FROM fsobjects WHERE digest = ${digest}
  `;

  if (existing.length === 0) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT lo_from_bytea(0, ${data}::bytea) as lob_oid
    `;
    const lobOid = result[0].lob_oid;

    await prisma.$executeRaw`
      INSERT INTO fsobjects (digest, lob_oid, description)
      VALUES (${digest}, ${lobOid}, 'Uploaded via Admin API')
    `;
  }

  return digest;
}

export async function POST(req: NextRequest) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  try {
    const data = await req.json();
    const { datasetId, testcases } = data;

    if (Array.isArray(testcases)) {
       // Batch upload
       for (const tc of testcases) {
         const inputBuffer = Buffer.from(tc.inputBase64, 'base64');
         const inputDigest = await storeFile(inputBuffer);
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
            console.warn(`Testcase ${tc.codename} already exists or error:`, e.message);
         }
       }
    } else {
       // Single upload
       const { codename, inputDigest, outputDigest, isPublic } = data;
       await prisma.testcases.create({
         data: {
           dataset_id: datasetId,
           codename,
           input: inputDigest,
           output: outputDigest,
           public: isPublic,
         }
       });
    }

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase(s) uploaded successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
