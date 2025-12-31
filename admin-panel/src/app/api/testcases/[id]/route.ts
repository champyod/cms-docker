import { prisma } from '@/lib/prisma';
import { verifyApiAuth, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    
    if (data.action === 'toggle-public') {
       const tc = await prisma.testcases.findUnique({ where: { id } });
       if (!tc) return apiError({ message: 'Testcase not found', status: 404 });
       await prisma.testcases.update({ where: { id }, data: { public: !tc.public } });
    } else {
       await prisma.testcases.update({
         where: { id },
         data: {
           ...(data.codename && { codename: data.codename }),
           ...(data.public !== undefined && { public: data.public }),
           ...(data.input && { input: data.input }),
           ...(data.output && { output: data.output }),
         }
       });
    }

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase updated successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized } = await verifyApiAuth();
  if (!authorized) return apiError({ message: 'Unauthorized', status: 401 });

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.testcases.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase deleted successfully' });
  } catch (error: any) {
    return apiError(error);
  }
}
