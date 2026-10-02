/**
 * Every SQL statement the merge applier executes, and the identities those
 * statements are built from: the staging schema name and lifecycle, the column
 * names the applier writes by name, and the row transport between the scratch
 * container and the live database.
 *
 * No docker, no Prisma, no filesystem: nothing here runs a statement, and each
 * builder refuses a name outside its allowlist before it quotes it. The
 * read-only measurement queries live in `restore-apply-sql-queries.ts`, and the
 * decisions these statements serve in `restore-apply-plan.ts`.
 */

import { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';

// ---------------------------------------------------------------------------
// Staging schema identity
// ---------------------------------------------------------------------------

export const STAGING_SCHEMA_PREFIX = 'restore_staging_';
const STAGING_SCHEMA_PATTERN = /^restore_staging_[0-9a-f]{8}$/;
const PREVIEW_ID_PATTERN = /^[0-9a-f]{32}$/;

/** The live-database schema that holds the archive's rows for one promote run. */
export function stagingSchemaName(previewId: string): string {
  if (!PREVIEW_ID_PATTERN.test(previewId)) throw new Error(`Refusing to build a staging schema from preview id: ${previewId}`);
  return `${STAGING_SCHEMA_PREFIX}${previewId.slice(0, 8)}`;
}

export function isStagingSchemaName(name: string): boolean {
  return STAGING_SCHEMA_PATTERN.test(name);
}

// ---------------------------------------------------------------------------
// Tables whose admin reference cannot be restored
// ---------------------------------------------------------------------------

/**
 * `admins` is never archived, so these three keep an `admin_id` that means
 * nothing live. The column is nullable on all three, so the apply writes NULL
 * and reports the row count it nulled.
 */
export const ADMIN_ID_COLUMN = 'admin_id';
export const ADMIN_NULL_TABLES: readonly string[] = ['announcements', 'messages', 'questions'];

// ---------------------------------------------------------------------------
// Large objects
// ---------------------------------------------------------------------------

export const LARGE_OBJECT_TABLE = 'fsobjects';
export const LARGE_OBJECT_DIGEST_COLUMN = 'digest';
export const LARGE_OBJECT_OID_COLUMN = 'loid';
export const LARGE_OBJECT_DESCRIPTION_COLUMN = 'description';
/** `pg_largeobject` stores one 8192-byte chunk per row, so chunk count times this is the byte length. */
export const LARGE_OBJECT_CHUNK_BYTES = 8192;
/**
 * Archive digests already stored live are reused by their live oid; only digests
 * live has never seen need their bytes copied out of the scratch container.
 * `lo_from_bytea` mints a fresh live oid, so the archive's own `loid` is never
 * trusted or reused: it names a large object inside the scratch database.
 */
export function fsobjectInsertSql(rows: readonly LargeObjectCopy[]): string {
  if (rows.length === 0) throw new Error('Refusing to build a large-object insert with no rows');
  const values = rows
    .map((row) => `('${sqlLiteral(row.digest)}', lo_from_bytea(0, decode('${row.encoded}', 'base64')), ${row.description === null ? 'NULL' : `'${sqlLiteral(row.description)}'`})`)
    .join(', ');
  return `INSERT INTO ${qualifiedTable('public', LARGE_OBJECT_TABLE)} ("${LARGE_OBJECT_DIGEST_COLUMN}", "${LARGE_OBJECT_OID_COLUMN}", "${LARGE_OBJECT_DESCRIPTION_COLUMN}") VALUES ${values} ON CONFLICT ("${LARGE_OBJECT_DIGEST_COLUMN}") DO NOTHING`;
}

export interface LargeObjectCopy {
  readonly digest: string;
  /** Base64 bytes read out of the scratch container's own large object. */
  readonly encoded: string;
  readonly description: string | null;
}

/** Digest text is a hex hash and a description is free text; both are escaped here. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

/** Aliases are build-time constants, so they are quoted once by `rowMatch`. */
const LIVE_ALIAS = 'live';
const STAGED_ALIAS = 'staged';

function selectList(columns: readonly string[], adminColumn: string | null): string {
  return columns.map((column) => (column === adminColumn ? 'NULL' : quoteIdentifier(column))).join(', ');
}

function rowMatch(liveAlias: string, stagingAlias: string, pkColumns: readonly string[]): string {
  const left = pkColumns.map((column) => `${quoteIdentifier(liveAlias)}.${quoteIdentifier(column)}`);
  const right = pkColumns.map((column) => `${quoteIdentifier(stagingAlias)}.${quoteIdentifier(column)}`);
  if (left.length === 1) return `${left[0]} = ${right[0]}`;
  return `(${left.join(', ')}) = (${right.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Staging schema lifecycle
// ---------------------------------------------------------------------------

export function createStagingSchemaSql(stagingSchema: string): string {
  if (!isStagingSchemaName(stagingSchema)) throw new Error(`Refusing to build SQL from schema: ${stagingSchema}`);
  return `CREATE SCHEMA ${quoteIdentifier(stagingSchema)}`;
}

export function dropStagingSchemaSql(stagingSchema: string): string {
  if (!isStagingSchemaName(stagingSchema)) throw new Error(`Refusing to build SQL from schema: ${stagingSchema}`);
  return `DROP SCHEMA IF EXISTS ${quoteIdentifier(stagingSchema)} CASCADE`;
}

/**
 * Staging tables are shaped from the live table rather than from the archive,
 * so the merge reads a column set the live schema is guaranteed to have. Plain
 * `LIKE` copies column names, types and NOT NULL only: no defaults, so staging
 * never draws from a live sequence, and no indexes or constraints, so no name
 * collides with a live index.
 */
export function createStagingTableSql(stagingSchema: string, table: string): string {
  return `CREATE TABLE ${qualifiedTable(stagingSchema, table)} (LIKE ${qualifiedTable('public', table)})`;
}

// ---------------------------------------------------------------------------
// Row data transport
// ---------------------------------------------------------------------------

/**
 * The archive's rows leave the scratch container as one JSON document per
 * table. `psql -t -A` prints a bare `SELECT` value with no command tag, which
 * `COPY ... TO STDOUT` cannot promise, so the rows are serialized here and
 * rebuilt by postgres on the live side.
 */
export function scratchExportSql(table: string, columns: readonly string[], pkColumns: readonly string[]): string {
  const selected = columns.map(quoteIdentifier).join(', ');
  const order = (pkColumns.length > 0 ? pkColumns : columns).map(quoteIdentifier).join(', ');
  return `SELECT coalesce(json_agg(row_to_json(s))::text, '[]') FROM (SELECT ${selected} FROM ${qualifiedTable('public', table)} ORDER BY ${order}) AS s`;
}

export function stagingLoadSql(stagingSchema: string, table: string, columns: readonly string[]): string {
  const record = `json_populate_recordset(NULL::${qualifiedTable(stagingSchema, table)}, $1::json) AS r`;
  const selected = columns.map((column) => `r.${quoteIdentifier(column)}`).join(', ');
  return `INSERT INTO ${qualifiedTable(stagingSchema, table)} (${columns.map(quoteIdentifier).join(', ')}) SELECT ${selected} FROM ${record}`;
}

export function scratchColumnsSql(table: string): string {
  return `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`;
}

export function setLocalTimeoutSql(timeoutMs: number): string {
  return `SET LOCAL statement_timeout = ${Math.max(1, Math.trunc(timeoutMs))}`;
}

// ---------------------------------------------------------------------------
// Merge and overwrite
// ---------------------------------------------------------------------------

/**
 * Merge-upsert: archive rows are inserted, and a row whose primary key already
 * exists live is updated from the archive except on the key itself and except
 * on the admin column, whose live value survives the merge because the
 * archive's admin_id names a row that was never archived. Both column lists are
 * explicit, so no statement can pick up a column the live table did not
 * declare.
 */
export function mergeInsertSql(
  table: string,
  stagingSchema: string,
  columns: readonly string[],
  pkColumns: readonly string[],
  adminColumn: string | null,
): string {
  if (columns.length === 0) throw new Error(`Refusing to build a merge for "${table}" with no columns`);
  const targets = columns.map(quoteIdentifier).join(', ');
  const conflict = pkColumns.map(quoteIdentifier).join(', ');
  const updates = columns
    .filter((column) => !pkColumns.includes(column) && column !== adminColumn)
    .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`);
  const onConflict = updates.length > 0 ? ` DO UPDATE SET ${updates.join(', ')}` : ' DO NOTHING';
  return `INSERT INTO ${qualifiedTable('public', table)} (${targets}) SELECT ${selectList(columns, adminColumn)} FROM ${qualifiedTable(stagingSchema, table)} ON CONFLICT (${conflict})${onConflict}`;
}

/** Delete the live rows the archive carries, matched on the whole composite key. */
export function overwriteDeleteSql(stagingSchema: string, table: string, pkColumns: readonly string[]): string {
  return `DELETE FROM ${qualifiedTable('public', table)} AS ${quoteIdentifier(LIVE_ALIAS)} USING ${qualifiedTable(stagingSchema, table)} AS ${quoteIdentifier(STAGED_ALIAS)} WHERE ${rowMatch(LIVE_ALIAS, STAGED_ALIAS, pkColumns)}`;
}

/** Plain insert of the staging rows, used after the overwrite delete inside the same transaction. */
export function insertSelectSql(table: string, stagingSchema: string, columns: readonly string[], adminColumn: string | null): string {
  return `INSERT INTO ${qualifiedTable('public', table)} (${columns.map(quoteIdentifier).join(', ')}) SELECT ${selectList(columns, adminColumn)} FROM ${qualifiedTable(stagingSchema, table)}`;
}

export function countRowsSql(schema: string, table: string): string {
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable(schema, table)}`;
}

/**
 * Archive rows whose primary key live does not have yet. One measurement serves
 * both strategies: a merge adds exactly these rows, and an overwrite deletes
 * `stagingRows - newRows` live rows and inserts all of them back.
 */
export function stagingNewRowCountSql(stagingSchema: string, table: string, pkColumns: readonly string[]): string {
  const live = quoteIdentifier(LIVE_ALIAS);
  const staged = quoteIdentifier(STAGED_ALIAS);
  const target = qualifiedTable('public', table);
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable(stagingSchema, table)} AS ${staged} WHERE NOT EXISTS (SELECT 1 FROM ${target} AS ${live} WHERE ${rowMatch(live, staged, pkColumns)})`;
}

/**
 * Delete live rows by a bounded batch of content hashes. The caller slices the
 * archive's digest list, so the statement never grows with the table.
 */
export function deleteDigestBatchSql(digests: readonly string[]): string {
  if (digests.length === 0) throw new Error('Refusing to build a delete with no digests');
  const list = digests.map((digest) => `'${sqlLiteral(digest)}'`).join(', ');
  return `DELETE FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} WHERE ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} IN (${list})`;
}

/**
 * Advance the sequence behind a single-column serial or identity primary key.
 *
 * `sequenceName` is what the live database reports for
 * `pg_get_serial_sequence`, so the caller resolves ownership from the database
 * rather than assuming it: a composite key owns none, and neither does a text
 * key such as `fsobjects.digest`. A null name means there is nothing to
 * advance and no statement is built. The next value is one past the highest
 * live id and left uncalled, which is idempotent and safe on an empty table.
 */
export function sequenceResetSql(table: string, pkColumn: string, sequenceName: string | null): string | null {
  if (sequenceName === null) return null;
  const column = quoteIdentifier(pkColumn);
  const next = `greatest(coalesce((SELECT max(${column}) FROM ${qualifiedTable('public', table)}), 0) + 1, 1)`;
  return `SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence($1, $2), ${next}, false)::text`;
}

/** The live database decides which primary keys own a sequence; this reports one. */
export function sequenceNameQuerySql(table: string, pkColumn: string): string {
  return `SELECT coalesce(pg_catalog.pg_get_serial_sequence('public.${table}', '${pkColumn}'), '')`;
}