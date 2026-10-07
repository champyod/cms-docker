import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('statement:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const beforeStatement = await prisma.statements.findUnique({ where: { id }, select: { task_id: true, language: true } });
    await prisma.statements.delete({ where: { id } });
    await recordAudit({
      verb: 'statement:delete',
      entity: 'statement',
      entityId: String(id),
      beforeValues: beforeStatement ? { task_id: beforeStatement.task_id, language: beforeStatement.language } : undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Statement deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
