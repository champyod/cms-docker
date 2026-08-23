import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = (await req.json()) as Record<string, unknown>;
    
    if (data.action === 'toggle-public') {
       const tc = await prisma.testcases.findUnique({ where: { id } });
       if (!tc) return apiError({ message: 'Testcase not found', status: 404 });
       await prisma.testcases.update({ where: { id }, data: { public: !tc.public } });
    } else {
       const updateData: Record<string, unknown> = {};
       if (data.codename) updateData.codename = data.codename as string;
       if (data.public !== undefined) updateData.public = data.public as boolean;
       if (data.input) updateData.input = data.input as string;
       if (data.output) updateData.output = data.output as string;
       await prisma.testcases.update({ where: { id }, data: updateData });
    }

    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase updated successfully' });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('tasks');
  if (!authorized) return response as Response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    await prisma.testcases.delete({ where: { id } });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Testcase deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
