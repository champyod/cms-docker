import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

interface MemberRow {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contestant_group:read');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const group = await prisma.contestant_groups.findUnique({ where: { id } });
    if (!group) return apiError({ message: 'Group not found', status: 404 });
    const members = (await prisma.$queryRaw`
      SELECT u.id, u.username, u.first_name, u.last_name
      FROM users u
      JOIN contestant_group_memberships m ON m.user_id = u.id
      WHERE m.group_id = ${id}
      ORDER BY u.username`) as MemberRow[];
    return apiSuccess({ group, members });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contestant_group:update');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data = await req.json();
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (!name) return apiError({ message: 'Group name is required', status: 400 });
    if (name.length > 191) return apiError({ message: 'Group name must be at most 191 characters', status: 400 });
    const before = await prisma.contestant_groups.findUnique({
      where: { id },
      select: { name: true, description: true },
    });
    if (!before) return apiError({ message: 'Group not found', status: 404 });
    const group = await prisma.contestant_groups.update({
      where: { id },
      data: { name, description: description || null },
    });
    await recordAudit({
      verb: 'contestant_group:update',
      entity: 'contestant_group',
      entityId: String(group.id),
      beforeValues: { name: before.name, description: before.description },
      afterValues: { name, description: description || null },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ group });
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'P2002') return apiError({ message: 'Group name already exists', status: 400 });
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contestant_group:delete');
  if (!authorized) return response;

  const id = parseInt((await params).id);
  if (isNaN(id)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const group = await prisma.contestant_groups.findUnique({ where: { id } });
    if (!group) return apiError({ message: 'Group not found', status: 404 });
    await prisma.contestant_groups.delete({ where: { id } });
    await recordAudit({
      verb: 'contestant_group:delete',
      entity: 'contestant_group',
      entityId: String(id),
      beforeValues: { name: group.name, description: group.description },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ message: 'Group deleted' });
  } catch (error) {
    return apiError(error);
  }
}
