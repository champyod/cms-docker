import { revalidatePath } from 'next/cache';
import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess } from '@/lib/api-utils';
import { csvEscape, randomToken, writeCredsCsv } from '@/lib/creds-file';
import {
  DEFAULT_PASSWORD_KIND,
  formatStoredPassword,
  isPasswordKind,
  parseStoredPassword,
  type PasswordKind,
} from '@/lib/password-format';

const CREDS_CSV_HEADER = 'id,username,password';
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

function makeUsername(firstName: string, lastName: string): string {
  const firstAscii = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (`${firstAscii}${lastAscii}` || 'user').slice(0, 20);
  return `${base}${randomToken(USERNAME_RANDOM_SUFFIX_LENGTH).toLowerCase()}`;
}

function makePassword(): string {
  return randomToken(14);
}

async function regenerateUser(
  user: { id: number; first_name: string; last_name: string },
  mode: 'username' | 'password',
  passwordKind: PasswordKind,
  localUsernames: Set<string>
): Promise<CredentialRow> {
  const updateData: { username?: string; password?: string } = {};
  const resultRow: CredentialRow = { id: user.id };

  if (mode === 'username') {
    const username = await ensureUniqueUsername(user.first_name, user.last_name, localUsernames);
    updateData.username = username;
    resultRow.username = username;
  }

  if (mode === 'password') {
    const plainPassword = makePassword();
    updateData.password = await formatStoredPassword(passwordKind, plainPassword);
    resultRow.password = plainPassword;
  }

  await prisma.users.update({
    where: { id: user.id },
    data: updateData,
  });

  return resultRow;
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

  const passwordKind = isPasswordKind(body.passwordKind) ? body.passwordKind : DEFAULT_PASSWORD_KIND;

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, first_name: true, last_name: true, username: true },
  });

  const localUsernames = new Set<string>();
  const updated: CredentialRow[] = [];
  for (const user of users) {
    updated.push(await regenerateUser(user, mode, passwordKind, localUsernames));
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

export async function handleExportCurrent({ userIds }: BatchActionRequest): Promise<NextResponse> {
  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, password: true },
    orderBy: { id: 'asc' },
  });

  let plainCount = 0;
  const rows: CredentialRow[] = users.map((user) => {
    const parsed = parseStoredPassword(user.password);
    if (parsed.kind === 'plaintext' && parsed.value) {
      plainCount += 1;
      return { id: user.id, username: user.username, password: parsed.value };
    }
    return { id: user.id, username: user.username };
  });

  revalidatePath('/[locale]/users', 'page');

  if (plainCount === 0) {
    return apiSuccess({ success: true, count: 0, note: 'No plain-text stored passwords in selection (bcrypt entries cannot be exported)' });
  }
  return issueCredentialsCsv(rows);
}

async function applyCredentialUpdate(
  u: { id?: number; username?: string; password?: string },
  passwordKind: PasswordKind,
  updated: CredentialRow[],
  failed: Array<{ id?: number; reason: string }>
): Promise<void> {
  const userId = Number(u.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    failed.push({ id: u.id, reason: 'invalid id' });
    return;
  }

  const data: { username?: string; password?: string } = {};
  if (u.username) data.username = String(u.username).trim();
  if (u.password) {
    data.password = await formatStoredPassword(passwordKind, String(u.password));
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

export async function handleApplyCredentials({ body }: BatchActionRequest): Promise<NextResponse> {
  const updates: Array<{ id?: number; username?: string; password?: string }> = Array.isArray(body.updates)
    ? body.updates
    : [];

  if (updates.length === 0) {
    return apiError({ message: 'updates is required', status: 400 });
  }

  const passwordKind = isPasswordKind(body.passwordKind) ? body.passwordKind : DEFAULT_PASSWORD_KIND;
  const updated: CredentialRow[] = [];
  const failed: Array<{ id?: number; reason: string }> = [];

  for (const u of updates) {
    await applyCredentialUpdate(u, passwordKind, updated, failed);
  }

  revalidatePath('/[locale]/users', 'page');

  if (updated.length === 0) {
    return apiSuccess({ success: true, count: 0, failed });
  }

  const { downloadUrl } = await writeCredsCsv(buildCredsCsv(updated));
  return apiSuccess({ success: true, downloadUrl, count: updated.length, failed });
}
