export type GenerationMode = 'none' | 'username' | 'password' | 'both';

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

interface CsvScannerState {
  current: string;
  row: string[];
  inQuotes: boolean;
}

function appendCell(state: CsvScannerState): void {
  state.row.push(state.current.trim());
  state.current = '';
}

function closeRecord(state: CsvScannerState, rows: string[][], consumeNext: boolean): boolean {
  appendCell(state);
  if (state.row.some((cell) => cell !== '')) rows.push(state.row);
  state.row = [];
  return consumeNext;
}

function processChar(char: string, next: string | undefined, state: CsvScannerState, rows: string[][]): boolean {
  if (char === '"') {
    if (state.inQuotes && next === '"') {
      state.current += '"';
      return true;
    }
    state.inQuotes = !state.inQuotes;
    return false;
  }

  if (char === ',' && !state.inQuotes) {
    appendCell(state);
    return false;
  }

  if ((char === '\n' || char === '\r') && !state.inQuotes) {
    return closeRecord(state, rows, char === '\r' && next === '\n');
  }

  state.current += char;
  return false;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const state: CsvScannerState = { current: '', row: [], inQuotes: false };

  for (let i = 0; i < text.length; i += 1) {
    if (processChar(text[i], text[i + 1], state, rows)) i += 1;
  }

  appendCell(state);
  if (state.row.some((cell) => cell !== '')) rows.push(state.row);

  return rows;
}

/** Client-side preview tokens are intentionally Math.random — they never authenticate anything. */
function randomToken(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

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

export function applyGeneration(row: PreviewRow, mode: GenerationMode, usedUsernames?: Set<string>): PreviewRow {
  const next = { ...row };

  if (!next.username && (mode === 'username' || mode === 'both')) {
    next.username = makeUsername(next.first_name, next.last_name, usedUsernames);
  }

  if (!next.password && (mode === 'password' || mode === 'both')) {
    next.password = makePassword();
  }

  return next;
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
export function fillRowCredentials(row: PreviewRow, mode: GenerationMode, usedUsernames: Set<string>): PreviewRow {
  const next = { ...row };

  if (!next.username && (mode === 'username' || mode === 'both')) {
    next.username = makeUsername(next.first_name, next.last_name, usedUsernames);
  } else if (next.username) {
    usedUsernames.add(next.username);
  }

  if (!next.password && (mode === 'password' || mode === 'both')) {
    next.password = makePassword();
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

function mapMatrixRow(
  cells: string[],
  mappedHeaders: (PreviewFieldKey | null)[],
  rowIndex: number,
  mode: GenerationMode,
  usedUsernames: Set<string>
): PreviewRow {
  const mapped = emptyPreviewRow(rowIndex);

  mappedHeaders.forEach((field, colIndex) => {
    if (!field) return;
    assignField(mapped, field, (cells[colIndex] ?? '').trim());
  });

  const withGenerated = applyGeneration(mapped, mode, usedUsernames);
  withGenerated.issues = collectIssues(withGenerated);

  return withGenerated;
}

export function buildPreviewRows(
  text: string,
  mode: GenerationMode
): { warnings: string[]; rows: PreviewRow[] } {
  const matrix = parseCsv(text);
  if (matrix.length === 0) {
    return { warnings: ['CSV is empty'], rows: [] };
  }

  const rawHeaders = matrix[0].map((header) => header.trim());
  const mappedHeaders = rawHeaders.map((header) => HEADER_ALIASES[header.toLowerCase()] || null);
  const usedUsernames = new Set<string>();

  const rows = matrix.slice(1).map((cells, rowIndex) =>
    mapMatrixRow(cells, mappedHeaders, rowIndex + 2, mode, usedUsernames)
  );

  return { warnings: collectHeaderWarnings(rawHeaders, mappedHeaders), rows };
}
