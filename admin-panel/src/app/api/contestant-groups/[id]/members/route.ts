import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

interface MembersBody {
  user_ids: number[];
}

type RouteParams = { params: Promise<{ id: string }> };

interface MemberRequest {
  groupId: number;
  userIds: number[];
  groupName: string;
}

type ParsedMemberRequest = { request: MemberRequest } | { response: Response };

function parseUserIds(data: MembersBody): number[] {
  return Array.isArray(data.user_ids)
    ? data.user_ids.filter((id) => Number.isInteger(id))
    : [];
}

async function readGroupName(groupId: number): Promise<string | null> {
  const group = await prisma.contestant_groups.findUnique({
    where: { id: groupId },
    select: { name: true },
  });
  return group === null ? null : group.name;
}

async function parseMemberRequest(
  req: NextRequest,
  params: RouteParams['params'],
): Promise<ParsedMemberRequest> {
  const groupId = parseInt((await params).id);
  if (isNaN(groupId)) return { response: apiError({ message: 'Invalid ID', status: 400 }) };
  const data: MembersBody = await req.json();
  const userIds = parseUserIds(data);
  if (userIds.length === 0) {
    return { response: apiError({ message: 'No user ids provided', status: 400 }) };
  }
  const groupName = await readGroupName(groupId);
  if (groupName === null) {
    return { response: apiError({ message: 'Group not found', status: 404 }) };
  }
  return { request: { groupId, userIds, groupName } };
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contestant_group:update');
  if (!authorized) return response;

  try {
    const parsed = await parseMemberRequest(req, params);
    if ('response' in parsed) return parsed.response;
    const { groupId, userIds, groupName } = parsed.request;

    const created = await prisma.contestant_group_memberships.createMany({
      data: userIds.map((userId) => ({ user_id: userId, group_id: groupId })),
      skipDuplicates: true,
    });
    await recordAudit({
      verb: 'contestant_group:update',
      entity: 'contestant_group',
      entityId: String(groupId),
      afterValues: { addedUserIds: userIds },
      reason: `Added ${created.count} member(s) to group "${groupName}"`,
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ added: created.count });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('contestant_group:update');
  if (!authorized) return response;

  try {
    const parsed = await parseMemberRequest(req, params);
    if ('response' in parsed) return parsed.response;
    const { groupId, userIds, groupName } = parsed.request;

    const removed = await prisma.contestant_group_memberships.deleteMany({
      where: { group_id: groupId, user_id: { in: userIds } },
    });
    await recordAudit({
      verb: 'contestant_group:update',
      entity: 'contestant_group',
      entityId: String(groupId),
      afterValues: { removedUserIds: userIds },
      reason: `Removed ${removed.count} member(s) from group "${groupName}"`,
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ removed: removed.count });
  } catch (error) {
    return apiError(error);
  }
}
