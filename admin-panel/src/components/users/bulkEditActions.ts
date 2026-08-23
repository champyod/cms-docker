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

export function downloadTextFile(content: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
