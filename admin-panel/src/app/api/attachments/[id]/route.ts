import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('attachment:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const beforeAttachment = await prisma.attachments.findUnique({ where: { id }, select: { task_id: true, filename: true } });
    await prisma.attachments.delete({ where: { id } });
    await recordAudit({
      verb: 'attachment:delete',
      entity: 'attachment',
      entityId: String(id),
      beforeValues: beforeAttachment ? { task_id: beforeAttachment.task_id, filename: beforeAttachment.filename } : undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/tasks', 'page');
    return apiSuccess({ message: 'Attachment deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
