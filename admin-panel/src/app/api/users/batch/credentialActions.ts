import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { revalidatePath } from 'next/cache';
import type { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess } from '@/lib/api-utils';

const BCRYPT_SALT_ROUNDS = 10;
const BCRYPT_PREFIX = 'bcrypt:';
const CREDS_CSV_HEADER = 'id,username,password';
const MAX_CLEANUP_SCAN_FILES = 500;
const CREDS_FILE_MAX_AGE_MS = 15 * 60 * 1000;
const CREDS_FILE_PREFIX = 'cms-creds-';
const USERNAME_RANDOM_SUFFIX_LENGTH = 4;
const MAX_USERNAME_GENERATION_ATTEMPTS = 100;

export interface BatchActionRequest {
  body: Record<string, unknown>;
  userIds: number[];
}

interface CredentialRow {
  id: number;
  username?: string;
  password?: string;
}

function randomToken(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function makeUsername(firstName: string, lastName: string): string {
  const firstAscii = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (`${firstAscii}${lastAscii}` || 'user').slice(0, 20);
  return `${base}${randomToken(USERNAME_RANDOM_SUFFIX_LENGTH).toLowerCase()}`;
}

function makePassword(): string {
  return randomToken(14);
}

async function ensureUniqueUsername(firstName: string, lastName: string, localSet: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < MAX_USERNAME_GENERATION_ATTEMPTS; attempt += 1) {
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

export async function cleanupExpiredCreds(): Promise<void> {
  try {
    const dir = os.tmpdir();
    const files = await fs.readdir(dir);
    if (files.length > MAX_CLEANUP_SCAN_FILES) return;
    const now = Date.now();
    await Promise.all(
      files
        .filter((f) => f.startsWith(CREDS_FILE_PREFIX) && (f.endsWith('.csv') || f.endsWith('.csv.used')))
        .map(async (f) => {
          try {
            const full = path.join(dir, f);
            const stat = await fs.stat(full);
            if (now - stat.mtimeMs > CREDS_FILE_MAX_AGE_MS) {
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
  const filePath = path.join(os.tmpdir(), `${CREDS_FILE_PREFIX}${token}.csv`);
  await fs.writeFile(filePath, content, { mode: 0o600 });
  return { token, downloadUrl: `/api/users/credentials/${token}` };
}

function buildCredsCsv(rows: CredentialRow[]): string {
  const lines = [CREDS_CSV_HEADER];
  for (const row of rows) {
    lines.push(`${row.id},${csvEscape(row.username ?? '')},${csvEscape(row.password ?? '')}`);
  }
  return `${lines.join('\n')}\n`;
}

async function issueCredentialsCsv(updated: CredentialRow[]): Promise<NextResponse> {
  const { downloadUrl } = await writeCredsCsv(buildCredsCsv(updated));
  return apiSuccess({ success: true, downloadUrl, count: updated.length });
}

export async function handleRegenerate({ body, userIds }: BatchActionRequest): Promise<NextResponse> {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const REGENERATE_MODES = ['username', 'password'] as const;
  const mode = REGENERATE_MODES.find((candidate) => candidate === body.mode);
  if (!mode) {
    return apiError({ message: 'Invalid regenerate mode', status: 400 });
  }

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, first_name: true, last_name: true, username: true },
  });

  const localUsernames = new Set<string>();
  const updated: CredentialRow[] = [];

  for (const user of users) {
    const updateData: { username?: string; password?: string } = {};
    const resultRow: CredentialRow = { id: user.id };

    if (mode === 'username') {
      const username = await ensureUniqueUsername(user.first_name, user.last_name, localUsernames);
      updateData.username = username;
      resultRow.username = username;
    }

    if (mode === 'password') {
      const plainPassword = makePassword();
      const hash = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
      updateData.password = `${BCRYPT_PREFIX}${hash}`;
      resultRow.password = plainPassword;
    }

    await prisma.users.update({
      where: { id: user.id },
      data: updateData,
    });

    updated.push(resultRow);
  }

  revalidatePath('/[locale]/users', 'page');

  if (updated.length === 0) {
    return apiSuccess({ success: true, count: 0, failed: [] });
  }

  if (mode === 'password') {
    return issueCredentialsCsv(updated);
  }

  if (Boolean(body.export)) {
    return issueCredentialsCsv(updated);
  }

  return apiSuccess({ success: true, count: updated.length });
}

export async function handleApplyCredentials({ body }: BatchActionRequest): Promise<NextResponse> {
  const updates: Array<{ id?: number; username?: string; password?: string }> = Array.isArray(body.updates)
    ? body.updates
    : [];

  if (updates.length === 0) {
    return apiError({ message: 'updates is required', status: 400 });
  }

  const updated: CredentialRow[] = [];
  const failed: Array<{ id?: number; reason: string }> = [];

  for (const u of updates) {
    const userId = Number(u.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      failed.push({ id: u.id, reason: 'invalid id' });
      continue;
    }

    const data: { username?: string; password?: string } = {};
    if (u.username) data.username = String(u.username).trim();
    if (u.password) {
      try {
        const hash = await bcrypt.hash(String(u.password), BCRYPT_SALT_ROUNDS);
        data.password = `${BCRYPT_PREFIX}${hash}`;
      } catch {
        failed.push({ id: userId, reason: 'password hash failed' });
        continue;
      }
    }

    try {
      await prisma.users.update({ where: { id: userId }, data });
      updated.push({ id: userId, username: data.username, password: u.password });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'P2002') {
        failed.push({ id: userId, reason: 'username already exists' });
      } else {
        failed.push({ id: userId, reason: String(e.message || err) });
      }
    }
  }

  revalidatePath('/[locale]/users', 'page');

  if (updated.length === 0) {
    return apiSuccess({ success: true, count: 0, failed });
  }

  const { downloadUrl } = await writeCredsCsv(buildCredsCsv(updated));
  return apiSuccess({ success: true, downloadUrl, count: updated.length, failed });
}
