import { apiClient } from '@/lib/apiClient';
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
}

export interface BatchActionResult {
  success?: boolean;
  error?: string;
  addedCount?: number;
  removedCount?: number;
  updatedCount?: number;
  count?: number;
  downloadUrl?: string;
}

export interface CredentialSetter {
  setLoading: (value: boolean) => void;
  setErrorMessage: (value: string) => void;
  setStatusMessage: (value: string) => void;
}

function collectCredentialUpdates(rows: SelectedUser[]): Array<{ id: number; username: string; password?: string | null }> {
  return rows
    .filter((r) => r.password || r.username)
    .map((r) => ({ id: r.id, username: r.username, password: r.password }));
}

export async function submitCredentialUpdates(
  rows: SelectedUser[],
  closeAfter: boolean,
  onClose: () => void,
  onSuccess: () => void,
  setters: CredentialSetter,
  passwordKind: PasswordKind
): Promise<void> {
  const { setLoading, setErrorMessage, setStatusMessage } = setters;
  const updates = collectCredentialUpdates(rows);

  if (updates.length === 0) {
    if (closeAfter) {
      onClose();
      return;
    }
    setErrorMessage('No generated credentials to apply');
    return;
  }

  setLoading(true);
  setErrorMessage('');
  setStatusMessage('');

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
  const { setLoading, setErrorMessage, setStatusMessage } = setters;

  try {
    const result = await apiClient.post('/api/users/batch', { action: 'apply-credentials', updates, passwordKind }) as BatchActionResult;

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to apply credentials');
      setLoading(false);
      return;
    }

    const count = typeof result.count === 'number' ? result.count : updates.length;
    if (result.downloadUrl) {
      openServerDownload(result.downloadUrl);
    }

    setStatusMessage(closeAfter ? `Applied and exported ${count} credential(s)` : `Applied credentials for ${count} user(s)`);
    setLoading(false);
    onSuccess();
    if (closeAfter) onClose();
  } catch (e) {
    setErrorMessage((e as Error)?.message || 'Network error');
    setLoading(false);
  }
}

function openServerDownload(downloadUrl: string): void {
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.setAttribute('download', `users-applied-${Date.now()}.csv`);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function csvEscapeValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
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
