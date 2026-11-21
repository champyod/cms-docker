import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';
import { writeContestUsername } from '@/lib/panel-actions';

const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

interface UsernameInput {
  contestId: number;
  userId: number;
  username: string;
}

type ParsedInput = { input: UsernameInput } | { response: Response };

async function parseUsernameInput(req: NextRequest): Promise<ParsedInput> {
  const data = await req.json();
  const contestId = Number(data.contest_id);
  const userId = Number(data.user_id);
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  if (!Number.isInteger(contestId) || !Number.isInteger(userId)) {
    return { response: apiError({ message: 'contest_id and user_id are required', status: 400 }) };
  }
  if (username !== '' && !USERNAME_PATTERN.test(username)) {
    return { response: apiError({ message: 'Username must contain only letters, numbers, hyphens and underscores', status: 400 }) };
  }
  return { input: { contestId, userId, username } };
}

async function findUsernameClash(input: UsernameInput): Promise<Response | null> {
  const { contestId, userId, username } = input;
  if (username === '') return null;
  const taken = (await prisma.$queryRaw`
    SELECT 1 FROM contest_usernames
    WHERE contest_id = ${contestId} AND username = ${username} AND user_id <> ${userId}
    LIMIT 1`) as Array<Record<string, number>>;
  if (taken.length > 0) {
    return apiError({ message: 'Display username already taken in this contest', status: 409 });
  }
  const login = (await prisma.$queryRaw`
    SELECT 1 FROM users WHERE username = ${username}
    UNION ALL
    SELECT 1 FROM admins WHERE username = ${username}
    LIMIT 1`) as Array<Record<string, number>>;
  if (login.length > 0) {
    return apiError({ message: 'Username collides with a login username', status: 400 });
  }
  return null;
}

async function readCurrentUsername(contestId: number, userId: number): Promise<string | null> {
  const rows = (await prisma.$queryRaw`
    SELECT username FROM contest_usernames
    WHERE contest_id = ${contestId} AND user_id = ${userId}`) as Array<{ username: string }>;
  return rows.length > 0 ? rows[0].username : null;
}

async function readParticipationId(contestId: number, userId: number): Promise<number | null> {
  const rows = (await prisma.$queryRaw`
    SELECT id FROM participations
    WHERE contest_id = ${contestId} AND user_id = ${userId}
    LIMIT 1`) as Array<{ id: number }>;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * WHY the write itself is not here: the day-2 rotation files the same alias and the same history
 * row for a whole roster, so the SQL lives in `lib/panel-actions/contest-accounts` once and both
 * this route and the batch call it. The route keeps only what a request owns — the permission, the
 * clash checks and the refresh.
 */
async function writeUsername(
  input: UsernameInput,
  participationId: number,
  adminId: number,
  next: string | null,
): Promise<void> {
  await writeContestUsername(prisma, {
    contestId: input.contestId,
    userId: input.userId,
    participationId,
    username: next,
    adminId,
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const { authorized, response } = await verifyApiPermission('user:read');
  if (!authorized) return response;

  const contestId = Number(req.nextUrl.searchParams.get('contest_id'));
  const userId = Number(req.nextUrl.searchParams.get('user_id'));
  if (!Number.isInteger(contestId) || !Number.isInteger(userId)) {
    return apiError({ message: 'contest_id and user_id are required', status: 400 });
  }

  try {
    return apiSuccess({ username: await readCurrentUsername(contestId, userId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const { authorized, response, session } = await verifyApiPermission('username:set');
  if (!authorized) return response;

  try {
    const parsed = await parseUsernameInput(req);
    if ('response' in parsed) return parsed.response;
    const input = parsed.input;

    const clash = await findUsernameClash(input);
    if (clash !== null) return clash;

    const before = await readCurrentUsername(input.contestId, input.userId);
    const next = input.username !== '' ? input.username : null;
    if (before === next) return apiSuccess({ username: before });

    const participationId = await readParticipationId(input.contestId, input.userId);
    if (participationId === null) {
      return apiError({ message: 'User is not participating in this contest', status: 404 });
    }

    const adminId = Number(session.userId);
    await writeUsername(input, participationId, adminId, next);
    await recordAudit({
      verb: 'contest_username:set',
      entity: 'contest_username',
      entityId: `${input.contestId}:${input.userId}`,
      beforeValues: { username: before },
      afterValues: { username: next },
      result: 'success',
    });
    revalidatePath('/[locale]/people/users', 'page');
    return apiSuccess({ username: next });
  } catch (error) {
    return apiError(error);
  }
}
