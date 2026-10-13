import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

interface MembersBody {
  user_ids: number[];
}

function parseUserIds(data: MembersBody): number[] {
  return Array.isArray(data.user_ids)
    ? data.user_ids.filter((id) => Number.isInteger(id))
    : [];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contestant_group:update');
  if (!authorized) return response;

  const groupId = parseInt((await params).id);
  if (isNaN(groupId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data: MembersBody = await req.json();
    const userIds = parseUserIds(data);
    if (userIds.length === 0) return apiError({ message: 'No user ids provided', status: 400 });
    const group = await prisma.contestant_groups.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    if (!group) return apiError({ message: 'Group not found', status: 404 });
    // WHY createMany: the bulk toggle writes every membership in
    // one statement, and skipDuplicates keeps a re-run idempotent.
    const created = await prisma.contestant_group_memberships.createMany({
      data: userIds.map((userId) => ({ user_id: userId, group_id: groupId })),
      skipDuplicates: true,
    });
    await recordAudit({
      verb: 'contestant_group:update',
      entity: 'contestant_group',
      entityId: String(groupId),
      afterValues: { addedUserIds: userIds },
      reason: `Added ${created.count} member(s) to group "${group.name}"`,
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ added: created.count });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authorized, response } = await verifyApiPermission('contestant_group:update');
  if (!authorized) return response;

  const groupId = parseInt((await params).id);
  if (isNaN(groupId)) return apiError({ message: 'Invalid ID', status: 400 });

  try {
    const data: MembersBody = await req.json();
    const userIds = parseUserIds(data);
    if (userIds.length === 0) return apiError({ message: 'No user ids provided', status: 400 });
    const group = await prisma.contestant_groups.findUnique({
      where: { id: groupId },
      select: { name: true },
    });
    if (!group) return apiError({ message: 'Group not found', status: 404 });
    const removed = await prisma.contestant_group_memberships.deleteMany({
      where: { group_id: groupId, user_id: { in: userIds } },
    });
    await recordAudit({
      verb: 'contestant_group:update',
      entity: 'contestant_group',
      entityId: String(groupId),
      afterValues: { removedUserIds: userIds },
      reason: `Removed ${removed.count} member(s) from group "${group.name}"`,
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ removed: removed.count });
  } catch (error) {
    return apiError(error);
  }
}
