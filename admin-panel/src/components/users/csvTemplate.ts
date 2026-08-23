import type { PreviewFieldKey, PreviewRow } from './csvPreview';

export const TEMPLATE_CSV =
  'first_name,last_name,username,password,email,timezone,team\n' +
  'John,Doe,johndoe,mySecret123,john@example.com,Asia/Bangkok,Team Alpha\n' +
  'Jane,Smith,,,jane@example.com,Asia/Bangkok,Team Beta';

export const EXPECTED_FIELDS: PreviewFieldKey[] = ['first_name', 'last_name', 'username', 'password', 'email', 'timezone', 'team'];

export function buildSelectedCsv(rows: PreviewRow[]): string {
  const lines = ['first_name,last_name,username,password,email,timezone,team'];
  rows.forEach((row) => {
    const cells = [row.first_name, row.last_name, row.username, row.password, row.email, row.timezone, row.team]
      .map((value) => `"${value.replace(/"/g, '""')}"`);
    lines.push(cells.join(','));
  });
  return `${lines.join('\n')}\n`;
}
