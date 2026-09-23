import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { storeFile } from '@/lib/fsobjects';
import { recordAudit } from '@/lib/audit';
import { MAX_BULK_TESTCASES, MAX_TESTCASE_FILE_BYTES } from '@/lib/testcase-limits';

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('testcase:create');
  if (!authorized) return response as Response;

  try {
    const data = (await req.json()) as {
      datasetId: number;
      testcases?: Array<{ inputBase64: string; outputBase64: string; codename: string; isPublic: boolean }>;
      codename?: string;
      inputDigest?: string;
      outputDigest?: string;
      isPublic?: boolean;
    };
    const { datasetId, testcases } = data;

    if (!Number.isInteger(datasetId)) return apiError({ message: 'Invalid dataset', status: 400 });
    const dataset = await prisma.datasets.findUnique({ where: { id: datasetId }, select: { id: true } });
    if (!dataset) return apiError({ message: 'Dataset not found', status: 404 });

    if (Array.isArray(testcases)) {
      if (testcases.length === 0) return apiError({ message: 'No testcases provided', status: 400 });
      if (testcases.length > MAX_BULK_TESTCASES) {
        return apiError({ message: `Too many testcases: limit is ${MAX_BULK_TESTCASES} per upload`, status: 400 });
      }
      let created = 0;
      let skipped = 0;
      for (const tc of testcases) {
        if (typeof tc.codename !== 'string' || tc.codename.length === 0) {
          return apiError({ message: 'Every testcase needs a codename', status: 400 });
        }
        let inputBuffer: Buffer;
        let outputBuffer: Buffer;
        try {
          inputBuffer = Buffer.from(tc.inputBase64, 'base64');
          outputBuffer = Buffer.from(tc.outputBase64, 'base64');
        } catch {
          return apiError({ message: `Testcase "${tc.codename}" has invalid file data`, status: 400 });
        }
        if (inputBuffer.length > MAX_TESTCASE_FILE_BYTES || outputBuffer.length > MAX_TESTCASE_FILE_BYTES) {
          return apiError({ message: `Testcase "${tc.codename}" exceeds the 2 MB per-file limit`, status: 400 });
        }
        const existing = await prisma.testcases.findUnique({
          where: { dataset_id_codename: { dataset_id: datasetId, codename: tc.codename } },
          select: { id: true },
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        const inputDigest = await storeFile(inputBuffer, 'Uploaded via Admin API');
        const outputDigest = await storeFile(outputBuffer, 'Uploaded via Admin API');

        try {
          await prisma.testcases.create({
            data: {
              dataset_id: datasetId,
              codename: tc.codename,
              input: inputDigest,
              output: outputDigest,
              public: tc.isPublic,
            },
          });
          created += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error';
          console.warn(`Testcase ${tc.codename} already exists or error:`, msg);
          skipped += 1;
        }
      }
      await recordAudit({
        verb: 'testcase:create',
        entity: 'testcase',
        afterValues: { datasetId, created, skipped },
        result: 'success',
      });
      revalidatePath('/[locale]/tasks', 'page');
      return apiSuccess({ message: 'Testcase(s) uploaded successfully', created, skipped });
    } else {
       const { codename, inputDigest, outputDigest, isPublic } = data;
       if (!codename || !inputDigest || !outputDigest) return apiError({ message: 'Missing testcase data', status: 400 });
       await prisma.testcases.create({
         data: {
           dataset_id: datasetId,
           codename: codename as string,
           input: inputDigest as string,
           output: outputDigest as string,
           public: (isPublic as boolean) ?? false,
         },
       });
    }

    await recordAudit({
      verb: 'testcase:create',
      entity: 'testcase',
      afterValues: { datasetId, codename: (data as { codename?: string }).codename ?? null },
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase uploaded successfully' });
  } catch (error) {
    return apiError(error);
  }
}
