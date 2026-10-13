import { apiClient } from '@/lib/apiClient';
import { openServerDownload } from '@/lib/csv-download';
import type { PasswordKind } from '@/lib/password-format';

export interface ContestOption {
  id: number;
  name: string;
}

export interface SelectedUser {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email?: string | null;
  /** Local preview plaintext only — never a stored hash; cleared on every load from the backend. */
  password?: string | null;
  /** Storage kind discovered via reveal; drives the muted bcrypt marker. */
  stored_kind?: 'bcrypt' | 'plaintext';
}

export interface BatchFailure {
  id?: number;
  reason: string;
}

export interface BatchActionResult {
  success?: boolean;
  error?: string;
  addedCount?: number;
  removedCount?: number;
  updatedCount?: number;
  count?: number;
  downloadUrl?: string;
  failed?: BatchFailure[];
}

export interface CredentialSetter {
  setLoading: (value: boolean) => void;
  setErrorMessage: (value: string) => void;
  setStatusMessage: (value: string) => void;
  setFailures: (value: BatchFailure[]) => void;
}

/**
 * Why the baseline is required: every row carries a username, so "has a username"
 * selected the whole selection and rewrote accounts nobody touched — and the endpoint
 * answered with a credentials CSV whose password cells were empty. Only a row whose
 * username or password actually moved is a change worth sending.
 */
export function collectCredentialUpdates(
  rows: readonly SelectedUser[],
  baseline: readonly SelectedUser[],
): Array<{ id: number; username: string; password?: string | null }> {
  const originalById = new Map(baseline.map((user) => [user.id, user]));
  return rows
    .filter((row) => {
      const original = originalById.get(row.id);
      if (original === undefined) return Boolean(row.password);
      return row.username !== original.username || Boolean(row.password);
    })
    .map((row) => ({ id: row.id, username: row.username, password: row.password }));
}

export async function submitCredentialUpdates(
  rows: readonly SelectedUser[],
  baseline: readonly SelectedUser[],
  closeAfter: boolean,
  onClose: () => void,
  onSuccess: () => void,
  setters: CredentialSetter,
  passwordKind: PasswordKind
): Promise<void> {
  const { setLoading, setErrorMessage, setStatusMessage, setFailures } = setters;
  const updates = collectCredentialUpdates(rows, baseline);

  if (updates.length === 0) {
    if (closeAfter) {
      onClose();
      return;
    }
    setErrorMessage('No credential changes to apply');
    return;
  }

  setLoading(true);
  setErrorMessage('');
  setStatusMessage('');
  setFailures([]);

  await postCredentialUpdates(updates, passwordKind, closeAfter, onClose, onSuccess, setters);
}

async function postCredentialUpdates(
  updates: Array<{ id: number; username: string; password?: string | null }>,
  passwordKind: PasswordKind,
  closeAfter: boolean,
  onClose: () => void,
  onSuccess: () => void,
  setters: CredentialSetter
): Promise<void> {
  const { setLoading, setErrorMessage, setStatusMessage, setFailures } = setters;

  try {
    const result = await apiClient.post('/api/users/batch', { action: 'apply-credentials', updates, passwordKind }) as BatchActionResult;

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to apply credentials');
      setLoading(false);
      return;
    }

    const count = typeof result.count === 'number' ? result.count : updates.length;
    const failed = Array.isArray(result.failed) ? result.failed : [];
    // Why the password check: the endpoint returns a CSV for whatever it changed.
    // Fetching it when no password moved hands the operator a sheet of empty password
    // cells under a message claiming credentials were exported.
    const passwordChanged = updates.some((update) => Boolean(update.password));
    setFailures(failed);
    if (result.downloadUrl && passwordChanged) {
      openServerDownload(result.downloadUrl, `users-applied-${Date.now()}.csv`);
    }

    const summary = `Applied credentials for ${count} user(s)`;
    if (failed.length > 0) {
      setStatusMessage(`${summary} — ${failed.length} failed`);
    } else {
      setStatusMessage(passwordChanged ? `${summary} and exported the new passwords` : summary);
    }
    setLoading(false);
    onSuccess();
    if (closeAfter) onClose();
  } catch (e) {
    setErrorMessage((e as Error)?.message || 'Network error');
    setLoading(false);
  }
}

/** Why prefix: Excel and LibreOffice execute a cell that opens with one of these
 * characters as a formula, so a stored value must arrive at the sheet as text. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvEscapeValue(value: unknown): string {
  const str = String(value ?? '');
  const quoted = str.replace(/"/g, '""');
  return `"${FORMULA_PREFIX.test(str) ? `'${quoted}` : quoted}"`;
}

export function buildEditExportCsv(rows: SelectedUser[]): string {
  const lines = ['id,first_name,last_name,username,password,email'];
  rows.forEach((row) => {
    lines.push([
      row.id,
      csvEscapeValue(row.first_name),
      csvEscapeValue(row.last_name),
      csvEscapeValue(row.username),
      csvEscapeValue(row.password ?? ''),
      csvEscapeValue(row.email ?? ''),
    ].join(','));
  });
  return `${lines.join('\n')}\n`;
}
