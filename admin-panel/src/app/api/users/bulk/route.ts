import { prisma } from '@/lib/prisma';
import { verifyApiPermission, apiError, apiSuccess } from '@/lib/api-utils';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

async function cleanupExpiredCreds(): Promise<void> {
  try {
    const dir = os.tmpdir();
    const files = await fs.readdir(dir);
    const now = Date.now();
    const maxAgeMs = 15 * 60 * 1000;
    await Promise.all(
      files
        .filter((f) => f.startsWith('cms-creds-') && f.endsWith('.csv'))
        .map(async (f) => {
          try {
            const full = path.join(dir, f);
            const stat = await fs.stat(full);
            if (now - stat.mtimeMs > maxAgeMs) {
              await fs.unlink(full);
            }
          } catch {
            // ignore per-file errors
          }
        })
    );
  } catch {
    // ignore cleanup errors
  }
}

function csvEscape(value: string): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function writeCredsCsv(content: string): Promise<{ token: string; downloadUrl: string }> {
  const token = crypto.randomBytes(24).toString('hex');
  const filePath = path.join(os.tmpdir(), `cms-creds-${token}.csv`);
  await fs.writeFile(filePath, content, { mode: 0o600 });
  return { token, downloadUrl: `/api/users/credentials/${token}` };
}

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifyApiPermission('users');
  if (!authorized) return response;

  await cleanupExpiredCreds();

  try {
    const body = await req.json();
    const rows: BulkUserRow[] = Array.isArray(body?.rows) ? body.rows : [];
    const generationMode: GenerationMode = body?.generationMode ?? 'none';
    const contestId = Number(body?.contestId || 0);

    if (rows.length === 0) {
      return apiError({ message: 'No rows provided', status: 400 });
    }

    const created: Array<{ rowIndex: number; username: string; plainPassword?: string }> = [];
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
      const teamCode = (row.team ?? '').trim();

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

      if (teamCode && !contestId) {
        failed.push({ rowIndex, reason: 'contestId is required when team is provided' });
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

        const user = await prisma.users.create({
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

        if (contestId) {
          let teamId: number | null = null;

          if (teamCode) {
            const existingTeam = await prisma.teams.findUnique({
              where: { code: teamCode },
              select: { id: true },
            });

            if (existingTeam) {
              teamId = existingTeam.id;
            } else {
              const createdTeam = await prisma.teams.create({
                data: {
                  code: teamCode,
                  name: teamCode,
                },
                select: { id: true },
              });
              teamId = createdTeam.id;
            }
          }

          await prisma.$executeRaw`
            INSERT INTO participations (contest_id, user_id, team_id, hidden, unrestricted, delay_time, extra_time)
            VALUES (${contestId}, ${user.id}, ${teamId}, false, false, '0 seconds'::interval, '0 seconds'::interval)
            ON CONFLICT (contest_id, user_id) DO NOTHING
          `;
        }

        const shouldExposePassword = shouldGeneratePassword(generationMode) && !(row.password ?? '').trim();
        created.push({
          rowIndex,
          username,
          plainPassword: shouldExposePassword ? plainPassword : undefined,
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
    if (contestId) {
      revalidatePath('/[locale]/contests', 'page');
    }

    const credsRows = created.filter((c) => c.plainPassword);
    if (credsRows.length > 0) {
      const lines = ['row_index,username,password'];
      for (const c of credsRows) {
        lines.push(`${c.rowIndex},${csvEscape(c.username)},${csvEscape(c.plainPassword ?? '')}`);
      }
      const csv = lines.join('\n') + '\n';
      const { downloadUrl } = await writeCredsCsv(csv);
      return apiSuccess({
        createdCount: created.length,
        failedCount: failed.length,
        downloadUrl,
        count: credsRows.length,
        failed,
      });
    }

    return apiSuccess({
      createdCount: created.length,
      failedCount: failed.length,
      failed,
    });
  } catch (error: any) {
    return apiError(error);
  }
}
