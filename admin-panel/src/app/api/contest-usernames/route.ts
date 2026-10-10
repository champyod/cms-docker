import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function GET(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('user:read');
  if (!authorized) return response;

  const contestId = Number(req.nextUrl.searchParams.get('contest_id'));
  const userId = Number(req.nextUrl.searchParams.get('user_id'));
  if (!Number.isInteger(contestId) || !Number.isInteger(userId)) {
    return apiError({ message: 'contest_id and user_id are required', status: 400 });
  }

  try {
    const rows = (await prisma.$queryRaw`
      SELECT username FROM contest_usernames
      WHERE contest_id = ${contestId} AND user_id = ${userId}`) as Array<{ username: string }>;
    return apiSuccess({ username: rows.length > 0 ? rows[0].username : null });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: NextRequest) {
  const { authorized, response, session } = await verifyApiPermission('username:set');
  if (!authorized) return response;

  try {
    const data = await req.json();
    const contestId = Number(data.contest_id);
    const userId = Number(data.user_id);
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    if (!Number.isInteger(contestId) || !Number.isInteger(userId)) {
      return apiError({ message: 'contest_id and user_id are required', status: 400 });
    }
    if (username !== '' && !USERNAME_PATTERN.test(username)) {
      return apiError({ message: 'Username must contain only letters, numbers, hyphens and underscores', status: 400 });
    }

    // WHY the collision checks: a display username must not equal
    // another contestant's display username in the same contest,
    // nor any login username, so the ranking stays unambiguous.
    if (username !== '') {
      const taken = (await prisma.$queryRaw`
        SELECT 1 FROM contest_usernames
        WHERE contest_id = ${contestId} AND username = ${username} AND user_id <> ${userId}
        LIMIT 1`) as Array<{ '?column?': number }>;
      if (taken.length > 0) {
        return apiError({ message: 'Display username already taken in this contest', status: 409 });
      }
      const login = (await prisma.$queryRaw`
        SELECT 1 FROM users WHERE username = ${username}
        UNION ALL
        SELECT 1 FROM admins WHERE username = ${username}
        LIMIT 1`) as Array<{ '?column?': number }>;
      if (login.length > 0) {
        return apiError({ message: 'Username collides with a login username', status: 400 });
      }
    }

    const current = (await prisma.$queryRaw`
      SELECT username FROM contest_usernames
      WHERE contest_id = ${contestId} AND user_id = ${userId}`) as Array<{ username: string }>;
    const before = current.length > 0 ? current[0].username : null;
    if (before === (username !== '' ? username : null)) {
      return apiSuccess({ username: before });
    }

    const participation = (await prisma.$queryRaw`
      SELECT id FROM participations
      WHERE contest_id = ${contestId} AND user_id = ${userId}
      LIMIT 1`) as Array<{ id: number }>;
    if (participation.length === 0) {
      return apiError({ message: 'User is not participating in this contest', status: 404 });
    }

    if (username === '') {
      await prisma.$executeRaw`
        DELETE FROM contest_usernames
        WHERE contest_id = ${contestId} AND user_id = ${userId}`;
    } else {
      await prisma.$executeRaw`
        INSERT INTO contest_usernames (participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id)
        VALUES (${participation[0].id}, ${contestId}, ${userId}, ${username}, now(), ${Number(session.userId)})
        ON CONFLICT (participation_id) DO UPDATE
          SET username = EXCLUDED.username,
              updated_at = EXCLUDED.updated_at,
              updated_by_admin_id = EXCLUDED.updated_by_admin_id`;
    }
    await prisma.$executeRaw`
      INSERT INTO contest_usernames_history (contest_id, user_id, username, set_at, set_by_admin_id)
      VALUES (${contestId}, ${userId}, ${username === '' ? null : username}, now(), ${Number(session.userId)})`;

    await recordAudit({
      verb: 'contest_username:set',
      entity: 'contest_username',
      entityId: `${contestId}:${userId}`,
      beforeValues: { username: before },
      afterValues: { username: username !== '' ? username : null },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ username: username !== '' ? username : null });
  } catch (error) {
    return apiError(error);
  }
}
