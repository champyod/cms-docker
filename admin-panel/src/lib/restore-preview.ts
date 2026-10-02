/**
 * Pure restore-preview logic: `pg_restore --list` parsing, archive-versus-live
 * diffing, JSON-safe sample shaping, and the preview identity/quarantine rules
 * that the upload route and the preview server actions must agree on.
 *
 * No docker, no Prisma, no filesystem writes: everything here is decided from
 * text, numbers and paths, so the preview rules are testable without a
 * database or a container runtime. The server actions in `src/app/actions/
 * restore.ts` own every effect; this module owns every decision about what
 * those effects mean.
 *
 * The preview never writes to the live database. Table counts and primary-key
 * overlap are read-only `SELECT`s, and the archive itself is only ever restored
 * into a throwaway container.
 */

import os from 'node:os';
import path from 'node:path';

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { isArchiveName } from '@/lib/backup-archives';

/** Postgres identifiers accepted in generated SQL; anything else is refused before it is quoted. */
export const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) throw new Error(`Refusing to build SQL from identifier: ${name}`);
  return `"${name}"`;
}

export function qualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

// ---------------------------------------------------------------------------
// pg_restore --list TOC parsing
// ---------------------------------------------------------------------------

export interface RestoreTocEntry {
  readonly schema: string | null;
  readonly name: string | null;
  readonly kind: string;
}

const TABLE_TOC_KINDS: ReadonlySet<string> = new Set(['TABLE', 'TABLE DATA', 'TABLE ATTACH']);

/** Second words of the multi-word TOC kinds, e.g. `TABLE DATA public contests`. */
const KIND_CONTINUATION_WORDS: ReadonlySet<string> = new Set(['DATA', 'SET', 'ATTACH']);

/**
 * A TOC line is `<dumpId>; <tableOid> <oid> <DESC> <name...> <owner>`. `DESC` is
 * `-` for objects that have none, and a two-word kind splits it across two
 * fields, so the kind has to be reassembled before the name can be located.
 *
 * Only the table kinds carry a schema and a name. A schema, sequence or blob
 * line has its own field layout, and anchoring those to the wrong columns would
 * report a name the archive does not contain.
 */
function parseTocLine(line: string): RestoreTocEntry | null {
  const separator = line.indexOf(';');
  if (separator < 0) return null;
  const fields = line.slice(separator + 1).trim().split(/\s+/);
  if (fields.length < 4) return null;
  const [tableOid, oid, descriptor, fourth] = fields;
  if (!/^\d+$/.test(tableOid) || !/^\d+$/.test(oid)) return null;
  const isCompound = KIND_CONTINUATION_WORDS.has(fourth);
  const kind = isCompound ? `${descriptor} ${fourth}` : descriptor;
  const rest = isCompound ? fields.slice(4) : fields.slice(3);
  if (!TABLE_TOC_KINDS.has(kind) || rest.length < 2) return { schema: null, name: null, kind };
  return { schema: rest[0], name: rest[1], kind };
}

export function parseRestoreList(tocText: string): RestoreTocEntry[] {
  const entries: RestoreTocEntry[] = [];
  for (const line of tocText.split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = parseTocLine(line);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

export function tocTableNames(entries: readonly RestoreTocEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.name !== null && TABLE_TOC_KINDS.has(entry.kind)) names.add(entry.name);
  }
  return [...names].sort();
}

export interface TocSummary {
  /** Table names the archive carries that the backup catalog knows. */
  readonly catalogTables: readonly string[];
  /** Table names the archive carries that the catalog does not: reported, never fatal. */
  readonly unknownTables: readonly string[];
  /** Non-table entries (schemas, sequences, blobs, constraints), counted for context only. */
  readonly otherEntryCount: number;
}

export function summarizeToc(entries: readonly RestoreTocEntry[]): TocSummary {
  const catalogTables: string[] = [];
  const unknownTables: string[] = [];
  let otherEntryCount = 0;
  for (const name of tocTableNames(entries)) {
    if (BACKUP_TABLE_NAMES.includes(name)) catalogTables.push(name);
    else unknownTables.push(name);
  }
  for (const entry of entries) {
    if (!TABLE_TOC_KINDS.has(entry.kind)) otherEntryCount += 1;
  }
  return { catalogTables, unknownTables, otherEntryCount };
}

// ---------------------------------------------------------------------------
// Archive-versus-live diff
// ---------------------------------------------------------------------------

export const NEW_ESTIMATE_METHOD = 'count-difference';
export const UPDATED_ESTIMATE_METHOD = 'archive-pk-sample-projected-to-live';

/** One archive primary-key sample measured against the live table. */
export interface PkOverlapSample {
  readonly overlap: number;
  readonly sampleSize: number;
}

export interface TableDiffRow {
  readonly table: string;
  /** False when the archive has no TOC entry for the table, so the zero row counts are not a measurement. */
  readonly archivePresent: boolean;
  readonly archiveRows: number;
  readonly liveRows: number;
  /** Rows the archive adds by count alone. Exact only when the archive is a strict superset. */
  readonly newEstimate: number;
  readonly newEstimateMethod: typeof NEW_ESTIMATE_METHOD;
  /** Archive rows whose primary key already exists live, projected from a primary-key sample. */
  readonly updatedEstimate: number;
  readonly updatedEstimateMethod: typeof UPDATED_ESTIMATE_METHOD;
  /** False when no sample was taken, which makes updatedEstimate 0 rather than unknown. */
  readonly updatedEstimateMeasured: boolean;
}

function overlapRatioOf(sample: PkOverlapSample | null): number {
  return sample === null || sample.sampleSize <= 0 ? 0 : sample.overlap / sample.sampleSize;
}

function buildDiffRow(
  table: string,
  archiveCounts: ReadonlyMap<string, number>,
  liveCounts: ReadonlyMap<string, number>,
  sample: PkOverlapSample | null,
): TableDiffRow {
  const archiveRows = archiveCounts.get(table) ?? 0;
  const liveRows = liveCounts.get(table) ?? 0;
  const measured = sample !== null && sample.sampleSize > 0;
  return {
    table,
    archivePresent: archiveCounts.has(table),
    archiveRows,
    liveRows,
    newEstimate: Math.max(0, archiveRows - liveRows),
    newEstimateMethod: NEW_ESTIMATE_METHOD,
    updatedEstimate: measured ? Math.min(archiveRows, Math.round(overlapRatioOf(sample) * archiveRows)) : 0,
    updatedEstimateMethod: UPDATED_ESTIMATE_METHOD,
    updatedEstimateMeasured: measured,
  };
}

/** `catalogOrder` decides the output order, so the preview lists tables parent-before-child. */
export function buildTableDiff(
  catalogOrder: readonly string[],
  archiveCounts: ReadonlyMap<string, number>,
  liveCounts: ReadonlyMap<string, number>,
  overlapSamples: ReadonlyMap<string, PkOverlapSample> = new Map(),
): readonly TableDiffRow[] {
  return catalogOrder.map((table) => buildDiffRow(table, archiveCounts, liveCounts, overlapSamples.get(table) ?? null));
}

/**
 * Primary-key text used for the overlap sample. A composite key has no single
 * column to sample, so it becomes its tuple joined by `|`, a separator no
 * primary-key text value can contain. The caller casts the column side to text
 * so the `IN` list is bound parameters rather than literal SQL.
 */
export function pkSampleExpression(pks: readonly string[]): string {
  const columns = pks.map(quoteIdentifier);
  if (columns.length === 1) return columns[0];
  return `(${columns.map((column) => `${column}::text`).join(" || '|' || ")})`;
}

// ---------------------------------------------------------------------------
// Sample rows
// ---------------------------------------------------------------------------

export const MAX_SAMPLE_ROWS = 10;
const MAX_JSON_DEPTH = 6;

export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

export interface SampleRowsShape {
  readonly columns: readonly string[];
  /** One array per row, positionally aligned to `columns`. */
  readonly rows: readonly JsonValue[];
}

export function clampSampleRowCount(count: unknown): number {
  const parsed = typeof count === 'number' ? Math.trunc(count) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_SAMPLE_ROWS);
}

function toJsonValue(value: unknown, depth: number): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  // Buffer is a Uint8Array, and bytea arrives from the driver as one.
  if (value instanceof Uint8Array) {
    return { type: 'bytes', byteLength: value.byteLength, base64: Buffer.from(value).toString('base64') };
  }
  if (depth >= MAX_JSON_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1));
  if (isCellRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item, depth + 1)]));
  }
  return null;
}

function isCellRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCell(row: unknown, column: string, index: number): unknown {
  if (Array.isArray(row)) return row[index];
  if (isCellRecord(row)) return row[column];
  return null;
}

/** Accepts positional rows or records keyed by column name and returns rows that survive `JSON.stringify`. */
export function shapeSampleRows(
  columns: readonly string[],
  rows: readonly unknown[],
  limit: number = MAX_SAMPLE_ROWS,
): SampleRowsShape {
  const capped = clampSampleRowCount(limit);
  return {
    columns: [...columns],
    rows: rows.slice(0, capped).map((row) => columns.map((column, index) => toJsonValue(readCell(row, column, index), 0))),
  };
}

// ---------------------------------------------------------------------------
// Preview identity, quarantine and upload rules
// ---------------------------------------------------------------------------

/** Quarantine lives in the OS temp directory so an upload can never land in the backup root. */
export const PREVIEW_ROOT_DIR_NAME = 'cms-restore-preview';
export const PREVIEW_ID_PATTERN = /^[0-9a-f]{32}$/;
export const SCRATCH_IMAGE = 'postgres:15';
export const UPLOAD_MAX_BYTES_DEFAULT = 5 * 1024 * 1024 * 1024;
export const UPLOAD_SIZE_LIMIT_ENV = 'RESTORE_PREVIEW_MAX_UPLOAD_BYTES';
export const MAX_PK_SAMPLE_ROWS = 200;
export const SCRATCH_POSTGRES_USER_DEFAULT = 'cmsuser';
export const SCRATCH_POSTGRES_DB_DEFAULT = 'cmsdb';
/**
 * Fixed throwaway password for the scratch container. Nothing listens on a
 * published port and every connection is a unix socket inside the container, so
 * the live database password is never read, copied or needed here.
 */
export const SCRATCH_POSTGRES_PASSWORD = 'cms-restore-preview';

/** Operator sweep for previews nobody deleted; every container carries this name prefix. */
export const ORPHAN_SWEEP_COMMAND = 'docker ps -aq --filter name=cms-restore-preview-';

export function isPreviewId(value: unknown): value is string {
  return typeof value === 'string' && PREVIEW_ID_PATTERN.test(value);
}

export function getPreviewRoot(): string {
  return path.join(os.tmpdir(), PREVIEW_ROOT_DIR_NAME);
}

export function previewQuarantineDir(previewId: string): string {
  return path.join(getPreviewRoot(), previewId);
}

export function previewDumpPath(previewId: string, fileName: string): string {
  return path.join(previewQuarantineDir(previewId), fileName);
}

export function previewContainerName(previewId: string): string {
  return `cms-restore-preview-${previewId}`;
}

export type UploadFileNameCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function checkUploadFileName(name: string): UploadFileNameCheck {
  if (name.endsWith('.tar.gz')) {
    return { ok: false, message: `${name} is a volume archive, not a database dump. Preview only reads pg_dump custom-format .dump files.` };
  }
  if (!isArchiveName(name)) return { ok: false, message: 'Archive name must match the backup archive pattern.' };
  if (!name.endsWith('.dump')) {
    return { ok: false, message: `Preview needs a pg_dump custom-format .dump archive; ${name} is not one.` };
  }
  return { ok: true };
}

export function getUploadMaxBytes(): number {
  const configured = Number(process.env[UPLOAD_SIZE_LIMIT_ENV]?.trim());
  return Number.isInteger(configured) && configured > 0 ? configured : UPLOAD_MAX_BYTES_DEFAULT;
}

export interface ScratchDatabaseEnv {
  readonly POSTGRES_USER: string;
  readonly POSTGRES_PASSWORD: string;
  readonly POSTGRES_DB: string;
}

/** The user and database come from the live environment so dumped role ownership still resolves. */
export function scratchDatabaseEnv(): ScratchDatabaseEnv {
  return {
    POSTGRES_USER: process.env.POSTGRES_USER?.trim() || SCRATCH_POSTGRES_USER_DEFAULT,
    POSTGRES_PASSWORD: SCRATCH_POSTGRES_PASSWORD,
    POSTGRES_DB: process.env.POSTGRES_DB?.trim() || SCRATCH_POSTGRES_DB_DEFAULT,
  };
}