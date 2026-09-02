import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { storeFile } from '@/lib/fsobjects';

export async function POST(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
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

    if (Array.isArray(testcases)) {
         for (const tc of testcases) {
          const inputBuffer = Buffer.from(tc.inputBase64, 'base64');
          const inputDigest = await storeFile(inputBuffer, 'Uploaded via Admin API');
          const outputBuffer = Buffer.from(tc.outputBase64, 'base64');
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
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            console.warn(`Testcase ${tc.codename} already exists or error:`, msg);
          }
       }
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

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase(s) uploaded successfully' });
  } catch (error) {
    return apiError(error);
  }
}
