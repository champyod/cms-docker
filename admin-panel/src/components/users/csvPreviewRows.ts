import { renderTemplate, USERNAME_CHARS, type GeneratorConfig } from '@/lib/credential-template';
import { detectFieldMismatches, formatMismatch, parseCsv } from './csvParsing';

export interface PreviewRow {
  rowIndex: number;
  first_name: string;
  last_name: string;
  username: string;
  password: string;
  email: string;
  timezone: string;
  team: string;
  issues: string[];
  selected?: boolean;
}

export type PreviewFieldKey = keyof Omit<PreviewRow, 'rowIndex' | 'issues' | 'selected'>;

/** One template per credential, each with the alphabet its runs are drawn from. */
export interface CredentialTemplates {
  username: string;
  password: string;
  usernameConfig: GeneratorConfig;
  passwordConfig: GeneratorConfig;
}

export const HEADER_ALIASES: Record<string, PreviewFieldKey> = {
  firstname: 'first_name',
  first_name: 'first_name',
  first: 'first_name',
  lastname: 'last_name',
  last_name: 'last_name',
  last: 'last_name',
  username: 'username',
  user: 'username',
  password: 'password',
  pass: 'password',
  email: 'email',
  mail: 'email',
  timezone: 'timezone',
  tz: 'timezone',
  team: 'team',
  teamname: 'team',
};

/** Client-side preview tokens are intentionally Math.random — they never authenticate anything. */
function randomToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

const MAX_USERNAME_ATTEMPTS = 30;
const USERNAME_SUFFIX_LENGTH = 4;

export function makeUsername(firstName: string, lastName: string, usedUsernames?: Set<string>): string {
  const firstAscii = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const lastAscii = lastName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  let base = `${firstAscii}${lastAscii}` || 'user';
  if (base.length > 20) {
    base = base.substring(0, 20);
  }

  let username = `${base}${randomToken(4).toLowerCase()}`;

  let attempts = 0;
  while (usedUsernames?.has(username) && attempts < 100) {
    username = `${base}${randomToken(4).toLowerCase()}`;
    attempts += 1;
  }

  usedUsernames?.add(username);
  return username;
}

export function makePassword(): string {
  return randomToken(14);
}

function collectIssues(row: PreviewRow): string[] {
  const issues: string[] = [];
  if (!row.first_name) issues.push('first_name missing');
  if (!row.last_name) issues.push('last_name missing');
  if (!row.username) issues.push('username missing');
  if (!row.password) issues.push('password missing');
  return issues;
}

/** A username may only use the alphabet the users API accepts, whatever the config asks for. */
function renderUsernameTemplate(templates: CredentialTemplates): string {
  return renderTemplate(templates.username, templates.usernameConfig, { charset: USERNAME_CHARS });
}

/**
 * Why the suffix: a random run can repeat within one batch, and a template with no `*`
 * renders the same name forever, so extending the name is the only way left to keep the
 * batch unique. The database side of the rule is enforced by the bulk endpoint.
 */
function renderUniqueUsername(templates: CredentialTemplates, usedUsernames: Set<string>): string {
  const base = renderUsernameTemplate(templates);
  let candidate = base;
  let attempts = 0;

  while (attempts < MAX_USERNAME_ATTEMPTS && usedUsernames.has(candidate)) {
    const rerolled = renderUsernameTemplate(templates);
    candidate = rerolled === base ? `${base}${randomToken(USERNAME_SUFFIX_LENGTH).toLowerCase()}` : rerolled;
    attempts += 1;
  }

  usedUsernames.add(candidate);
  return candidate;
}

function assignField(row: PreviewRow, field: PreviewFieldKey, value: string): void {
  switch (field) {
    case 'first_name': row.first_name = value; break;
    case 'last_name': row.last_name = value; break;
    case 'username': row.username = value; break;
    case 'password': row.password = value; break;
    case 'email': row.email = value; break;
    case 'timezone': row.timezone = value; break;
    case 'team': row.team = value; break;
  }
}

/** Fills empty credentials in-place for already-parsed rows, tracking existing usernames to avoid batch collisions. */
export function fillRowCredentials(
  row: PreviewRow,
  templates: CredentialTemplates,
  usedUsernames: Set<string>
): PreviewRow {
  const next = { ...row };

  if (next.username) {
    usedUsernames.add(next.username);
  } else {
    next.username = renderUniqueUsername(templates, usedUsernames);
  }

  if (!next.password) {
    next.password = renderTemplate(templates.password, templates.passwordConfig);
  }

  next.issues = collectIssues(next);
  return next;
}

function collectHeaderWarnings(rawHeaders: string[], mappedHeaders: (PreviewFieldKey | null)[]): string[] {
  const warnings: string[] = [];
  if (!mappedHeaders.includes('first_name')) warnings.push('Missing column: first_name (or alias firstname/first)');
  if (!mappedHeaders.includes('last_name')) warnings.push('Missing column: last_name (or alias lastname/last)');

  const unknownHeaders = rawHeaders.filter((header, index) => header && !mappedHeaders[index]);
  if (unknownHeaders.length > 0) {
    warnings.push(`Unknown columns ignored: ${unknownHeaders.join(', ')}`);
  }

  return warnings;
}

function emptyPreviewRow(rowIndex: number): PreviewRow {
  return {
    rowIndex,
    first_name: '',
    last_name: '',
    username: '',
    password: '',
    email: '',
    timezone: '',
    team: '',
    issues: [],
    selected: false,
  };
}

function mapMatrixRow(cells: string[], mappedHeaders: (PreviewFieldKey | null)[], rowIndex: number): PreviewRow {
  const mapped = emptyPreviewRow(rowIndex);

  mappedHeaders.forEach((field, colIndex) => {
    if (!field) return;
    assignField(mapped, field, (cells[colIndex] ?? '').trim());
  });

  mapped.issues = collectIssues(mapped);
  return mapped;
}

/** Parses the draft exactly as written; credentials arrive only from the reader's fill action. */
export function buildPreviewRows(text: string): { warnings: string[]; rows: PreviewRow[] } {
  const matrix = parseCsv(text);
  if (matrix.length === 0) {
    return { warnings: ['CSV is empty'], rows: [] };
  }

  const rawHeaders = matrix[0].map((header) => header.trim());
  const mappedHeaders = rawHeaders.map((header) => HEADER_ALIASES[header.toLowerCase()] || null);
  const mismatches = detectFieldMismatches(matrix);
  const mismatchByMatrixIndex = new Map(mismatches.map((mismatch) => [mismatch.rowIndex - 1, mismatch]));

  const rows = matrix.slice(1).map((cells, rowIndex) => {
    const preview = mapMatrixRow(cells, mappedHeaders, rowIndex + 2);
    const mismatch = mismatchByMatrixIndex.get(rowIndex + 1);
    return mismatch === undefined ? preview : { ...preview, issues: [...preview.issues, formatMismatch(mismatch)] };
  });

  const warnings = collectHeaderWarnings(rawHeaders, mappedHeaders);
  if (mismatches.length > 0) {
    warnings.push(`${mismatches.length} row(s) have a different field count than the header`);
  }

  return { warnings, rows };
}
