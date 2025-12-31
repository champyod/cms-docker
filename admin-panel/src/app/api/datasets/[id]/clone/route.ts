import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const { newDescription } = await req.json();
    const original = await prisma.datasets.findUnique({
      where: { id },
      include: { testcases: true, managers: true }
    });
    
    if (!original) return apiError({ message: 'Dataset not found', status: 404 });
    
    const newDataset = await prisma.datasets.create({
      data: {
        task_id: original.task_id,
        description: newDescription,
        time_limit: original.time_limit,
        memory_limit: original.memory_limit,
        task_type: original.task_type,
        task_type_parameters: original.task_type_parameters as any,
        score_type: original.score_type,
        score_type_parameters: original.score_type_parameters as any,
        autojudge: false,
      }
    });
    
    for (const tc of original.testcases) {
      await prisma.testcases.create({
        data: {
          dataset_id: newDataset.id,
          codename: tc.codename,
          public: tc.public,
          input: tc.input,
          output: tc.output,
        }
      });
    }
    
    for (const mgr of original.managers) {
      await prisma.managers.create({
        data: {
          dataset_id: newDataset.id,
          filename: mgr.filename,
          digest: mgr.digest,
        }
      });
    }
    
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ dataset: newDataset });
  } catch (error: any) {
    return apiError(error);
  }
}
