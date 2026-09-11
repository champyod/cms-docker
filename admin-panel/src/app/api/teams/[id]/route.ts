import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('team:update');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const beforeTeam = await prisma.teams.findUnique({ where: { id }, select: { code: true, name: true } });
    await prisma.teams.update({
      where: { id },
      data: {
        ...(data.code && { code: data.code }),
        ...(data.name && { name: data.name }),
      }
    });

    await recordAudit({
      verb: 'team:update',
      entity: 'team',
      entityId: String(id),
      beforeValues: beforeTeam ? { code: beforeTeam.code, name: beforeTeam.name } : undefined,
      afterValues: { code: data.code, name: data.name },
      result: 'success',
    });
    revalidatePath('/[locale]/teams', 'page');
    return apiSuccess({ message: 'Team updated successfully' });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('team:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const beforeDeleteTeam = await prisma.teams.findUnique({ where: { id }, select: { code: true, name: true } });
    await prisma.teams.delete({ where: { id } });
    await recordAudit({
      verb: 'team:delete',
      entity: 'team',
      entityId: String(id),
      beforeValues: beforeDeleteTeam ? { code: beforeDeleteTeam.code, name: beforeDeleteTeam.name } : undefined,
      result: 'success',
    });
    revalidatePath('/[locale]/teams', 'page');
    return apiSuccess({ message: 'Team deleted successfully' });
  } catch (error) {
    return apiError(error);
  }
}
