import { prisma } from '@/lib/prisma';
import { randomToken } from '@/lib/creds-file';

export type GenerationMode = 'none' | 'username' | 'password' | 'both';

export interface BulkUserRow {
  first_name?: string;
  last_name?: string;
  username?: string;
  password?: string;
  email?: string;
  timezone?: string;
  team?: string;
  rowIndex?: number;
}

export interface PreparedRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  username: string;
  plainPassword: string;
  email: string;
  timezone: string;
  teamCode: string;
  hadExplicitPassword: boolean;
}

export interface RowFailure {
  rowIndex: number;
  reason: string;
}

const MAX_USERNAME_ATTEMPTS = 30;

function normalizeUsernameBase(firstName: string, lastName: string): string {
  const joined = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (joined.length >= 3) return joined;
  return `user${randomToken(6)}`;
}

async function ensureUniqueUsername(base: string): Promise<string> {
  let candidate = base;
  let attempts = 0;

  while (attempts < MAX_USERNAME_ATTEMPTS) {
    const exists = await prisma.users.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!exists) return candidate;
    candidate = `${base}${randomToken(4)}`;
    attempts += 1;
  }

  return `${base}${randomToken(8)}`;
}

function shouldGenerateUsername(mode: GenerationMode): boolean {
  return mode === 'username' || mode === 'both';
}

export function shouldGeneratePassword(mode: GenerationMode): boolean {
  return mode === 'password' || mode === 'both';
}

function readRowFields(row: BulkUserRow, fallbackIndex: number) {
  return {
    rowIndex: row.rowIndex ?? fallbackIndex,
    firstName: (row.first_name ?? '').trim(),
    lastName: (row.last_name ?? '').trim(),
    username: (row.username ?? '').trim(),
    plainPassword: (row.password ?? '').trim(),
    email: (row.email ?? '').trim(),
    timezone: (row.timezone ?? '').trim(),
    teamCode: (row.team ?? '').trim(),
    hadExplicitPassword: Boolean((row.password ?? '').trim()),
  };
}

async function generateMissingCredentials(
  fields: ReturnType<typeof readRowFields>,
  generationMode: GenerationMode
): Promise<{ username: string; plainPassword: string }> {
  let username = fields.username;
  if (!username && shouldGenerateUsername(generationMode)) {
    username = await ensureUniqueUsername(normalizeUsernameBase(fields.firstName, fields.lastName));
  }

  let plainPassword = fields.plainPassword;
  if (!plainPassword && shouldGeneratePassword(generationMode)) {
    plainPassword = randomToken(14);
  }

  return { username, plainPassword };
}

export async function prepareRow(
  row: BulkUserRow,
  fallbackIndex: number,
  generationMode: GenerationMode,
  contestId: number,
  seenUsernames: Set<string>
): Promise<PreparedRow | RowFailure> {
  const fields = readRowFields(row, fallbackIndex);

  if (!fields.firstName || !fields.lastName) {
    return { rowIndex: fields.rowIndex, reason: 'first_name and last_name are required' };
  }

  const { username, plainPassword } = await generateMissingCredentials(fields, generationMode);

  if (!username) {
    return { rowIndex: fields.rowIndex, reason: 'username is required (or enable username generation)' };
  }
  if (!plainPassword) {
    return { rowIndex: fields.rowIndex, reason: 'password is required (or enable password generation)' };
  }
  if (fields.teamCode && !contestId) {
    return { rowIndex: fields.rowIndex, reason: 'contestId is required when team is provided' };
  }
  if (seenUsernames.has(username)) {
    return { rowIndex: fields.rowIndex, reason: `duplicate username in CSV payload: ${username}` };
  }
  seenUsernames.add(username);

  return { ...fields, username, plainPassword };
}
