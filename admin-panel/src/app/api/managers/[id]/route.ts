import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { recordAudit } from '@/lib/audit';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('manager:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const beforeManager = await prisma.managers.findUnique({ where: { id }, select: { dataset_id: true, filename: true } });
    await prisma.managers.delete({ where: { id } });
    await recordAudit({
      verb: 'manager:delete',
      entity: 'manager',
      entityId: String(id),
      beforeValues: beforeManager ? { dataset_id: beforeManager.dataset_id, filename: beforeManager.filename } : undefined,
      result: 'success',
    });
    return apiSuccess({ message: 'Manager file deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
