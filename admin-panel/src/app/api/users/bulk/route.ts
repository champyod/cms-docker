import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

type GenerationMode = 'none' | 'username' | 'password' | 'both';

type BulkUserRow = {
  first_name?: string;
  last_name?: string;
  username?: string;
  password?: string;
  email?: string;
  timezone?: string;
  team?: string;
  rowIndex?: number;
};

function randomToken(length: number) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function randomPassword() {
  return randomToken(14);
}

function normalizeUsernameBase(firstName: string, lastName: string) {
  const joined = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (joined.length >= 3) return joined;
  return `user${randomToken(6)}`;
}

async function ensureUniqueUsername(base: string) {
  let candidate = base;
  let attempts = 0;

  while (attempts < 30) {
    const exists = await prisma.users.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!exists) return candidate;
    candidate = `${base}${randomToken(4)}`;
    attempts += 1;
  }

  return `${base}${randomToken(8)}`;
}

function shouldGenerateUsername(mode: GenerationMode) {
  return mode === 'username' || mode === 'both';
}

function shouldGeneratePassword(mode: GenerationMode) {
  return mode === 'password' || mode === 'both';
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  try {
    const body = await req.json();
    const rows: BulkUserRow[] = Array.isArray(body?.rows) ? body.rows : [];
    const generationMode: GenerationMode = body?.generationMode ?? 'none';

    if (rows.length === 0) {
      return apiError({ message: 'No rows provided', status: 400 });
    }

    const created: Array<{ rowIndex: number; username: string; password?: string }> = [];
    const failed: Array<{ rowIndex: number; reason: string }> = [];
    const seenUsernames = new Set<string>();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowIndex = row.rowIndex ?? i + 2;

      const firstName = (row.first_name ?? '').trim();
      const lastName = (row.last_name ?? '').trim();
      let username = (row.username ?? '').trim();
      let plainPassword = (row.password ?? '').trim();
      const email = (row.email ?? '').trim();
      const timezone = (row.timezone ?? '').trim();

      if (!firstName || !lastName) {
        failed.push({ rowIndex, reason: 'first_name and last_name are required' });
        continue;
      }

      if (!username && shouldGenerateUsername(generationMode)) {
        const base = normalizeUsernameBase(firstName, lastName);
        username = await ensureUniqueUsername(base);
      }

      if (!plainPassword && shouldGeneratePassword(generationMode)) {
        plainPassword = randomPassword();
      }

      if (!username) {
        failed.push({ rowIndex, reason: 'username is required (or enable username generation)' });
        continue;
      }

      if (!plainPassword) {
        failed.push({ rowIndex, reason: 'password is required (or enable password generation)' });
        continue;
      }

      if (seenUsernames.has(username)) {
        failed.push({ rowIndex, reason: `duplicate username in CSV payload: ${username}` });
        continue;
      }
      seenUsernames.add(username);

      try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(plainPassword, salt);

        await prisma.users.create({
          data: {
            first_name: firstName,
            last_name: lastName,
            username,
            email: email || null,
            password: `bcrypt:${hash}`,
            timezone: timezone || null,
            preferred_languages: [],
          },
        });

        created.push({
          rowIndex,
          username,
          password: shouldGeneratePassword(generationMode) && !(row.password ?? '').trim() ? plainPassword : undefined,
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          failed.push({ rowIndex, reason: `username already exists: ${username}` });
        } else {
          failed.push({ rowIndex, reason: error.message || 'unknown error' });
        }
      }
    }

    revalidatePath('/[locale]/users', 'page');

    return apiSuccess({
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
      note: 'team column is accepted for preview/mapping but not applied in user creation from this endpoint',
    });
  } catch (error: any) {
    return apiError(error);
  }
}
