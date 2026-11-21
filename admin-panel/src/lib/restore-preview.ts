/**
 * Pure restore-preview logic: `pg_restore --list` parsing, archive-versus-live
 * diffing and JSON-safe sample shaping.
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

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';

// The upload route reads the preview identity rules from here; they live in the store.
export { checkUploadFileName, getUploadMaxBytes, isPreviewId, previewDumpPath, previewQuarantineDir } from '@/lib/restore-preview-store';

// The identifier rules live in their own module, because this one reaches
// `node:os` and the conflict vocabulary that quotes with them is shared with the
// panel. Re-exported here so every existing import keeps resolving.
import { IDENTIFIER_PATTERN, qualifiedTable, quoteIdentifier } from '@/lib/sql-identifier';
export { IDENTIFIER_PATTERN, qualifiedTable, quoteIdentifier };

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