import { revalidatePath } from 'next/cache';
import type { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess, verifyApiPermission } from '@/lib/api-utils';
import { recordAudit } from '@/lib/audit';
import { buildCredsCsv, writeCredsCsv, type CredentialRow } from '@/lib/creds-file';
import { ensureUniqueUsername, makePassword } from '@/lib/credential-generation';
import {
  DEFAULT_PASSWORD_KIND,
  formatStoredPassword,
  isPasswordKind,
  parseStoredPassword,
  type PasswordKind,
} from '@/lib/password-format';

const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002';

export interface BatchActionRequest {
  body: Record<string, unknown>;
  userIds: number[];
}

type RegenerateMode = 'username' | 'password';

function parseRegenerateMode(body: Record<string, unknown>): RegenerateMode | null {
  const modes: readonly RegenerateMode[] = ['username', 'password'];
  const found = modes.find((candidate) => candidate === body.mode);
  return found ?? null;
}

async function regenerateUser(
  user: { id: number; first_name: string; last_name: string },
  mode: RegenerateMode,
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
    const plainPassword: string = makePassword();
    updateData.password = await formatStoredPassword(passwordKind, plainPassword);
    resultRow.password = plainPassword;
  }

  await prisma.users.update({
    where: { id: user.id },
    data: updateData,
  });

  return resultRow;
}

async function regenerateAllUsers(
  users: Array<{ id: number; first_name: string; last_name: string }>,
  mode: RegenerateMode,
  passwordKind: PasswordKind
): Promise<CredentialRow[]> {
  const localUsernames = new Set<string>();
  const updated: CredentialRow[] = [];
  for (const user of users) {
    updated.push(await regenerateUser(user, mode, passwordKind, localUsernames));
  }
  return updated;
}

async function issueCredentialsCsv(updated: CredentialRow[]): Promise<NextResponse> {
  const { downloadUrl } = await writeCredsCsv(buildCredsCsv(updated));
  return apiSuccess({ success: true, downloadUrl, count: updated.length });
}

function toExportRows(
  users: Array<{ id: number; username: string; password: string }>
): { rows: CredentialRow[]; plainCount: number } {
  let plainCount = 0;
  const rows: CredentialRow[] = users.map((user) => {
    const parsed = parseStoredPassword(user.password);
    if (parsed.kind === 'plaintext' && parsed.value) {
      plainCount += 1;
      return { id: user.id, username: user.username, password: parsed.value };
    }
    return { id: user.id, username: user.username };
  });
  return { rows, plainCount };
}

function resolveRegenerateResponse(updated: CredentialRow[], mode: RegenerateMode, wantsExport: boolean): Promise<NextResponse> | NextResponse {
  if (updated.length === 0) {
    return apiSuccess({ success: true, count: 0, failed: [] });
  }
  if (mode === 'password' || wantsExport) {
    return issueCredentialsCsv(updated);
  }
  return apiSuccess({ success: true, count: updated.length });
}

export async function handleRegenerate({ body, userIds }: BatchActionRequest): Promise<NextResponse> {
  // WHY user:update: this creates/replaces usernames and passwords — a user
  // write. The CSV it returns carries credentials it just generated.
  const { authorized, response } = await verifyApiPermission('user:update');
  if (!authorized) {
    return response;
  }

  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const mode = parseRegenerateMode(body);
  if (!mode) {
    return apiError({ message: 'Invalid regenerate mode', status: 400 });
  }

  const passwordKind = isPasswordKind(body.passwordKind) ? body.passwordKind : DEFAULT_PASSWORD_KIND;

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, first_name: true, last_name: true, username: true },
  });

  const updated = await regenerateAllUsers(users, mode, passwordKind);

  await recordAudit({
    verb: 'user:update',
    entity: 'user',
    afterValues: { action: 'batch-regenerate', mode, count: updated.length, userIds },
    result: 'success',
  });
  revalidatePath('/[locale]/users', 'page');

  return resolveRegenerateResponse(updated, mode, Boolean(body.export));
}

export async function handleExportCurrent({ userIds }: BatchActionRequest): Promise<NextResponse> {
  // WHY password:reveal: this reads stored plaintext passwords and returns them
  // as a CSV. It writes nothing, but disclosure is the sensitive act, so it is
  // gated on the same permission as the single-user reveal.
  const { authorized, response } = await verifyApiPermission('password:reveal');
  if (!authorized) {
    return response;
  }

  if (userIds.length === 0) {
    return apiError({ message: 'userIds is required', status: 400 });
  }

  const users = await prisma.users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, password: true },
    orderBy: { id: 'asc' },
  });

  const { rows, plainCount } = toExportRows(users);

  await recordAudit({
    verb: 'password:reveal',
    entity: 'user',
    afterValues: { action: 'batch-export-current', userIds, plainCount, totalCount: users.length },
    result: 'success',
  });
  revalidatePath('/[locale]/users', 'page');

  if (plainCount === 0) {
    return apiSuccess({
      success: true,
      count: 0,
      note: 'No plain-text stored passwords in selection (bcrypt entries cannot be exported)',
    });
  }
  return issueCredentialsCsv(rows);
}

async function applyCredentialUpdate(
  u: { id?: number; username?: string; password?: string },
  passwordKind: PasswordKind,
  updated: CredentialRow[],
  failed: Array<{ id?: number; reason: string }>
): Promise<void> {
  const userId: number = Number(u.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    failed.push({ id: u.id, reason: 'invalid id' });
    return;
  }

  const data: { username?: string; password?: string } = {};
  if (u.username) {
    data.username = String(u.username).trim();
  }
  if (u.password) {
    data.password = await formatStoredPassword(passwordKind, String(u.password));
  }

  try {
    await prisma.users.update({ where: { id: userId }, data });
    updated.push({ id: userId, username: data.username, password: u.password });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === PRISMA_UNIQUE_CONSTRAINT_CODE) {
      failed.push({ id: userId, reason: 'username already exists' });
    } else {
      failed.push({ id: userId, reason: String(e.message || err) });
    }
  }
}

export async function handleApplyCredentials({ body }: BatchActionRequest): Promise<NextResponse> {
  // WHY user:update: this writes usernames and passwords onto users.
  const { authorized, response } = await verifyApiPermission('user:update');
  if (!authorized) {
    return response;
  }

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

  await recordAudit({
    verb: 'user:update',
    entity: 'user',
    afterValues: { action: 'batch-apply-credentials', count: updated.length, failedCount: failed.length },
    result: 'success',
  });
  revalidatePath('/[locale]/users', 'page');

  if (updated.length === 0) {
    return apiSuccess({ success: true, count: 0, failed });
  }

  const { downloadUrl } = await writeCredsCsv(buildCredsCsv(updated));
  return apiSuccess({ success: true, downloadUrl, count: updated.length, failed });
}
