/**
 * The name a streamed dump downloads as, and the selection a request may carry.
 *
 * No docker, no Prisma, no filesystem: the transport lives in
 * `backup-export-stream.ts`, and what a request is allowed to ask for is decided
 * here so it can be tested without a request or a container.
 */

import { orderSelection, validateTableSelection } from '@/lib/backup-table-catalog';

/** The name `scripts/__backup.sh` writes, so a download can be uploaded back as a preview. */
const EXPORT_NAME_PREFIX = 'cmsdb';
const EXPORT_NAME_SUFFIX = '.dump';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * `cmsdb-YYYYmmdd-HHMMSS.dump`, in UTC.
 *
 * The shape is the one the archive name pattern already accepts, so what the
 * panel streams out can be uploaded back in as a preview. UTC rather than local
 * time so the same instant always names the same file.
 */
export function exportFileName(epochMs: number): string {
  const at = new Date(epochMs);
  const date = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
  const time = `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}`;
  return `${EXPORT_NAME_PREFIX}-${date}-${time}${EXPORT_NAME_SUFFIX}`;
}

export type ExportSelection =
  | { readonly ok: true; readonly tables: readonly string[]; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

const MISSING_SELECTION = 'Name the tables to export with ?tables=a,b,c.';

/**
 * The tables a request asked for, in catalog order.
 *
 * Every name is checked against the catalog before it can reach a shell argument,
 * and an absent or empty list is refused rather than read as "everything": a bare
 * request must not dump the whole database by accident, and `pg_dump` with no
 * `-t` flag does exactly that.
 */
export function parseExportSelection(raw: string | null): ExportSelection {
  if (raw === null) return { ok: false, error: MISSING_SELECTION };
  const tables = [...new Set(raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0))];
  if (tables.length === 0) return { ok: false, error: MISSING_SELECTION };
  const validation = validateTableSelection(tables);
  if (!validation.valid) {
    if (validation.unknown.length > 0) return { ok: false, error: `Not in the backup table catalog: ${validation.unknown.join(', ')}` };
    return { ok: false, error: validation.warnings[0] ?? MISSING_SELECTION };
  }
  return { ok: true, tables: orderSelection(tables), warnings: validation.warnings };
}
