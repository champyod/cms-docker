import { prisma } from '@/lib/prisma';
import { randomToken } from '@/lib/creds-file';
import { normalizeLanguageCode } from '@/lib/constants/languages';
import {
  MAX_GENERATOR_LENGTH,
  MIN_GENERATOR_LENGTH,
  PASSWORD_CONFIG,
  renderTemplate,
  USERNAME_CHARS,
  USERNAME_CONFIG,
  type CaseMode,
  type GeneratorConfig,
} from '@/lib/credential-template';

export interface BulkUserRow {
  first_name?: string;
  last_name?: string;
  username?: string;
  password?: string;
  email?: string;
  timezone?: string;
  team?: string;
  rowIndex?: number;
  preferred_languages?: string | string[];
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
  preferredLanguages: string[];
}

export interface RowFailure {
  rowIndex: number;
  reason: string;
}

/** One credential template per field, each with the alphabet its runs are drawn from. */
export interface CredentialTemplates {
  username: string;
  password: string;
  usernameConfig: GeneratorConfig;
  passwordConfig: GeneratorConfig;
}

const MAX_USERNAME_ATTEMPTS = 30;
const USERNAME_SUFFIX_LENGTH = 4;
const USERNAME_FALLBACK_SUFFIX_LENGTH = 8;

const CASE_MODES: readonly CaseMode[] = ['both', 'upper', 'lower'];

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readLength(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_GENERATOR_LENGTH, Math.min(MAX_GENERATOR_LENGTH, Math.trunc(parsed)));
}

/**
 * Why the payload is re-read rather than trusted: the config decides how a run is drawn,
 * so a length or a case mode outside the popup would let a caller shape credentials the
 * panel never offered.
 */
function readGeneratorConfig(raw: unknown, fallback: GeneratorConfig): GeneratorConfig {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  return {
    length: readLength(record.length, fallback.length),
    letters: readBoolean(record.letters, fallback.letters),
    caseMode: CASE_MODES.find((mode) => mode === record.caseMode) ?? fallback.caseMode,
    numbers: readBoolean(record.numbers, fallback.numbers),
    specials: readBoolean(record.specials, fallback.specials),
    operators: readBoolean(record.operators, fallback.operators),
  };
}

export function readCredentialTemplates(body: unknown): CredentialTemplates {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return {
    username: typeof source.usernameTemplate === 'string' ? source.usernameTemplate : '',
    password: typeof source.passwordTemplate === 'string' ? source.passwordTemplate : '',
    usernameConfig: readGeneratorConfig(source.usernameConfig, USERNAME_CONFIG),
    passwordConfig: readGeneratorConfig(source.passwordConfig, PASSWORD_CONFIG),
  };
}

/** Only the alphabet the users API accepts, whatever the config asks for. */
function renderUsernameTemplate(templates: CredentialTemplates): string {
  return renderTemplate(templates.username, templates.usernameConfig, { charset: USERNAME_CHARS });
}

async function usernameTaken(candidate: string, seenUsernames: Set<string>): Promise<boolean> {
  if (seenUsernames.has(candidate)) return true;
  const existing = await prisma.users.findUnique({ where: { username: candidate }, select: { id: true } });
  return existing !== null;
}

/**
 * Re-rolls the template's random run until the name is free within the batch and in the
 * database. A template with no `*` renders the same name on every attempt, so a suffix is
 * the only way to tell such rows apart, and the longer one ends a crowded search.
 */
async function ensureUniqueUsername(templates: CredentialTemplates, seenUsernames: Set<string>): Promise<string> {
  const base = renderUsernameTemplate(templates);
  let candidate = base;
  let attempts = 0;

  while (attempts < MAX_USERNAME_ATTEMPTS) {
    if (!(await usernameTaken(candidate, seenUsernames))) return candidate;
    const rerolled = renderUsernameTemplate(templates);
    candidate = rerolled === base ? `${base}${randomToken(USERNAME_SUFFIX_LENGTH)}` : rerolled;
    attempts += 1;
  }

  return `${base}${randomToken(USERNAME_FALLBACK_SUFFIX_LENGTH)}`;
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
    rawPreferredLanguages: row.preferred_languages,
  };
}

function parsePreferredLanguages(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of raw) {
      const code = typeof entry === 'string' ? normalizeLanguageCode(entry) : '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      result.push(code);
    }
    return result;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const part of raw.split(',')) {
      const code = normalizeLanguageCode(part);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      result.push(code);
    }
    return result;
  }
  return [];
}

async function generateMissingCredentials(
  fields: ReturnType<typeof readRowFields>,
  templates: CredentialTemplates,
  seenUsernames: Set<string>
): Promise<{ username: string; plainPassword: string }> {
  const username = fields.username || await ensureUniqueUsername(templates, seenUsernames);
  const plainPassword = fields.plainPassword || renderTemplate(templates.password, templates.passwordConfig);

  return { username, plainPassword };
}

export async function prepareRow(
  row: BulkUserRow,
  fallbackIndex: number,
  templates: CredentialTemplates,
  contestId: number,
  seenUsernames: Set<string>
): Promise<PreparedRow | RowFailure> {
  const fields = readRowFields(row, fallbackIndex);

  if (!fields.firstName || !fields.lastName) {
    return { rowIndex: fields.rowIndex, reason: 'first_name and last_name are required' };
  }

  const { username, plainPassword } = await generateMissingCredentials(fields, templates, seenUsernames);

  if (!username) {
    return { rowIndex: fields.rowIndex, reason: 'username is required' };
  }
  if (!plainPassword) {
    return { rowIndex: fields.rowIndex, reason: 'password is required' };
  }
  if (fields.teamCode && !contestId) {
    return { rowIndex: fields.rowIndex, reason: 'contestId is required when team is provided' };
  }
  if (seenUsernames.has(username)) {
    return { rowIndex: fields.rowIndex, reason: `duplicate username in CSV payload: ${username}` };
  }
  seenUsernames.add(username);

  return { ...fields, username, plainPassword, preferredLanguages: parsePreferredLanguages(fields.rawPreferredLanguages) };
}
