import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

interface ContestantGroupRow {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
}

export async function GET(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('contestant_group:list');
  if (!authorized) return response;

  try {
    // WHY the raw query: the member count comes from a single
    // grouped join, which no prisma client relation can express
    // without loading every membership.
    const groups = (await prisma.$queryRaw`
      SELECT g.id, g.name, g.description,
             COUNT(m.user_id)::int AS member_count
      FROM contestant_groups g
      LEFT JOIN contestant_group_memberships m ON m.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name`) as ContestantGroupRow[];
    return apiSuccess({ groups });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('contestant_group:create');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const description = typeof data.description === 'string' ? data.description.trim() : '';
    if (!name) return apiError({ message: 'Group name is required', status: 400 });
    if (name.length > 191) return apiError({ message: 'Group name must be at most 191 characters', status: 400 });
    const group = await prisma.contestant_groups.create({
      data: { name, description: description || null },
    });
    await recordAudit({
      verb: 'contestant_group:create',
      entity: 'contestant_group',
      entityId: String(group.id),
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
