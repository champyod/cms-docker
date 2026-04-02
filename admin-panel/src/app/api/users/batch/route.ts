import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';

type BatchAction = 'regenerate' | 'contest' | 'team' | 'profile' | 'apply-credentials';
type RegenerateMode = 'username' | 'password';
type ContestMode = 'add' | 'remove';
type TeamMode = 'set' | 'remove-any';
type ProfileMode = 'timezone' | 'email-domain' | 'clear-email';

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

    if (action === 'regenerate') {
      if (userIds.length === 0) {
        return apiError({ message: 'userIds is required', status: 400 });
      }
      const mode: RegenerateMode = body?.mode;
      if (!mode || !['username', 'password'].includes(mode)) {
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

        if (mode === 'username') {
          const username = await ensureUniqueUsername(user.first_name, user.last_name, localUsernames);
          updateData.username = username;
          resultRow.username = username;
        }

        if (mode === 'password') {
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

      // If export requested, return a CSV attachment containing the exact
      // plaintext passwords/usernames that were applied so the exported file
      // matches what was stored.
      const doExport = Boolean(body?.export);
      if (doExport) {
        const rows = ['id,username,password'];
        for (const r of updated) rows.push(`${r.id},${r.username ?? ''},${r.password ?? ''}`);
        const csv = rows.join('\n');
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="users_regenerated.csv"',
          },
        });
      }

      return apiSuccess({ success: true, updated });
    }

    if (action === 'apply-credentials') {
      const updates: Array<{ id: number; username?: string; password?: string }> = Array.isArray(body?.updates)
        ? body.updates
        : [];

      if (updates.length === 0) {
        return apiError({ message: 'updates is required', status: 400 });
      }

      const updated: Array<{ id: number; username?: string; password?: string }> = [];
      const failed: Array<{ id?: number; reason: string }> = [];

      for (const u of updates) {
        const userId = Number(u.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          failed.push({ id: u.id, reason: 'invalid id' });
          continue;
        }

        const data: any = {};
        if (u.username) data.username = String(u.username).trim();
        if (u.password) {
          try {
            const hash = await bcrypt.hash(String(u.password), 10);
            data.password = `bcrypt:${hash}`;
          } catch (e) {
            failed.push({ id: userId, reason: 'password hash failed' });
            continue;
          }
        }

        try {
          await prisma.users.update({ where: { id: userId }, data });
          updated.push({ id: userId, username: data.username, password: u.password });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            failed.push({ id: userId, reason: 'username already exists' });
          } else {
            failed.push({ id: userId, reason: String(err?.message || err) });
          }
        }
      }

      revalidatePath('/[locale]/users', 'page');
      // Support exporting the exact plaintexts applied as a CSV so the
      // exported file always matches what was saved.
      const doExportApply = Boolean(body?.export);
      if (doExportApply) {
        const rows = ['id,username,password'];
        for (const r of updated) rows.push(`${r.id},${r.username ?? ''},${r.password ?? ''}`);
        const csv = rows.join('\n');
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="users_applied.csv"',
          },
        });
      }

      return apiSuccess({ success: true, updated, failed });
    }

    if (action === 'contest') {
      if (userIds.length === 0) {
        return apiError({ message: 'userIds is required', status: 400 });
      }
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

    if (action === 'team') {
      if (userIds.length === 0) {
        return apiError({ message: 'userIds is required', status: 400 });
      }
      const mode: TeamMode = body?.mode;

      if (!mode || !['set', 'remove-any'].includes(mode)) {
        return apiError({ message: 'Invalid team mode', status: 400 });
      }

      if (mode === 'remove-any') {
        const cleared = await prisma.participations.updateMany({
          where: {
            user_id: { in: userIds },
            team_id: { not: null },
          },
          data: {
            team_id: null,
          },
        });

        revalidatePath('/[locale]/users', 'page');
        revalidatePath('/[locale]/contests', 'page');
        return apiSuccess({ success: true, updatedCount: cleared.count });
      }

      const contestId = Number(body?.contestId);
      const teamCode = String(body?.teamCode || '').trim();

      if (!Number.isInteger(contestId) || contestId <= 0) {
        return apiError({ message: 'Invalid contestId', status: 400 });
      }

      if (!teamCode) {
        return apiError({ message: 'teamCode is required', status: 400 });
      }

      const existingTeam = await prisma.teams.findUnique({
        where: { code: teamCode },
        select: { id: true },
      });

      const teamId = existingTeam
        ? existingTeam.id
        : (await prisma.teams.create({ data: { code: teamCode, name: teamCode }, select: { id: true } })).id;

      let updatedCount = 0;
      for (const userId of userIds) {
        const affected = await prisma.$executeRaw`
          INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
          VALUES (${contestId}, ${userId}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
          ON CONFLICT (contest_id, user_id) DO UPDATE
          SET team_id = EXCLUDED.team_id
        `;
        if (affected > 0) updatedCount += 1;
      }

      revalidatePath('/[locale]/users', 'page');
      revalidatePath('/[locale]/contests', 'page');
      return apiSuccess({ success: true, updatedCount, teamId, teamCode });
    }

    if (action === 'profile') {
      if (userIds.length === 0) {
        return apiError({ message: 'userIds is required', status: 400 });
      }
      const mode: ProfileMode = body?.mode;
      if (!mode || !['timezone', 'email-domain', 'clear-email'].includes(mode)) {
        return apiError({ message: 'Invalid profile mode', status: 400 });
      }

      if (mode === 'timezone') {
        const timezone = String(body?.timezone || '').trim();
        if (!timezone) {
          return apiError({ message: 'timezone is required', status: 400 });
        }

        const result = await prisma.users.updateMany({
          where: { id: { in: userIds } },
          data: { timezone },
        });

        revalidatePath('/[locale]/users', 'page');
        return apiSuccess({ success: true, updatedCount: result.count });
      }

      if (mode === 'clear-email') {
        const result = await prisma.users.updateMany({
          where: { id: { in: userIds } },
          data: { email: null },
        });

        revalidatePath('/[locale]/users', 'page');
        return apiSuccess({ success: true, updatedCount: result.count });
      }

      const emailDomain = String(body?.emailDomain || '').trim().toLowerCase();
      if (!emailDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain)) {
        return apiError({ message: 'Valid emailDomain is required', status: 400 });
      }

      const users = await prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
      });

      let updatedCount = 0;
      for (const user of users) {
        const localPart = (user.email?.split('@')[0] || user.username).trim();
        const nextEmail = `${localPart}@${emailDomain}`;
        await prisma.users.update({
          where: { id: user.id },
          data: { email: nextEmail },
        });
        updatedCount += 1;
      }

      revalidatePath('/[locale]/users', 'page');
      return apiSuccess({ success: true, updatedCount });
    }

    return apiError({ message: 'Invalid action', status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
