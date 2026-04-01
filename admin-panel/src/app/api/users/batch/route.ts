import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';

type BatchAction = 'regenerate' | 'contest';
type RegenerateMode = 'username' | 'password' | 'both';
type ContestMode = 'add' | 'remove';

function randomToken(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function makeUsername(firstName: string, lastName: string) {
  const firstAscii = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (`${firstAscii}${lastAscii}` || 'user').slice(0, 20);
  return `${base}${randomToken(4).toLowerCase()}`;
}

function makePassword() {
  return randomToken(14);
}

async function ensureUniqueUsername(firstName: string, lastName: string, localSet: Set<string>) {
  for (let i = 0; i < 100; i += 1) {
    const candidate = makeUsername(firstName, lastName);
    if (localSet.has(candidate)) continue;

    const existing = await prisma.users.findUnique({
      where: { username: candidate },
      select: { id: true },
    });

    if (!existing) {
      localSet.add(candidate);
      return candidate;
    }
  }

  throw new Error('Unable to generate unique username');
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const body = await req.json();
    const action: BatchAction = body?.action;
    const userIds: number[] = Array.isArray(body?.userIds)
      ? body.userIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];

    if (userIds.length === 0) {
      return apiError({ message: 'userIds is required', status: 400 });
    }

    if (action === 'regenerate') {
      const mode: RegenerateMode = body?.mode;
      if (!mode || !['username', 'password', 'both'].includes(mode)) {
        return apiError({ message: 'Invalid regenerate mode', status: 400 });
      }

      const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, first_name: true, last_name: true, username: true },
      });

      const localUsernames = new Set<string>();
      const updated: Array<{ id: number; username?: string; password?: string }> = [];

      for (const user of users) {
        const updateData: { username?: string; password?: string } = {};
        const resultRow: { id: number; username?: string; password?: string } = { id: user.id };

        if (mode === 'username' || mode === 'both') {
          const username = await ensureUniqueUsername(user.first_name, user.last_name, localUsernames);
          updateData.username = username;
          resultRow.username = username;
        }

        if (mode === 'password' || mode === 'both') {
          const plainPassword = makePassword();
          const hash = await bcrypt.hash(plainPassword, 10);
          updateData.password = `bcrypt:${hash}`;
          resultRow.password = plainPassword;
        }

        await prisma.users.update({
          where: { id: user.id },
          data: updateData,
        });

        updated.push(resultRow);
      }

      revalidatePath('/[locale]/users', 'page');
      return apiSuccess({ success: true, updated });
    }

    if (action === 'contest') {
      const mode: ContestMode = body?.mode;
      const contestId = Number(body?.contestId);

      if (!mode || !['add', 'remove'].includes(mode)) {
        return apiError({ message: 'Invalid contest mode', status: 400 });
      }

      if (!Number.isInteger(contestId) || contestId <= 0) {
        return apiError({ message: 'Invalid contestId', status: 400 });
      }

      if (mode === 'add') {
        let addedCount = 0;

        for (const userId of userIds) {
          const inserted = await prisma.$executeRaw`
            INSERT INTO participations (contest_id, user_id, hidden, unrestricted, delay_time, extra_time)
            VALUES (${contestId}, ${userId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
            ON CONFLICT (contest_id, user_id) DO NOTHING
          `;
          if (inserted > 0) addedCount += 1;
        }

        revalidatePath('/[locale]/users', 'page');
        revalidatePath('/[locale]/contests', 'page');
        return apiSuccess({ success: true, addedCount, removedCount: 0 });
      }

      const removed = await prisma.participations.deleteMany({
        where: {
          contest_id: contestId,
          user_id: { in: userIds },
        },
      });

      revalidatePath('/[locale]/users', 'page');
      revalidatePath('/[locale]/contests', 'page');
      return apiSuccess({ success: true, addedCount: 0, removedCount: removed.count });
    }

    return apiError({ message: 'Invalid action', status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
