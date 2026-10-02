/**
 * Pure restore-apply logic: staging-schema naming, the confirmation-token
 * binding, the read-only validation decisions and every SQL statement the merge
 * applier executes.
 *
 * No docker, no Prisma, no filesystem: everything here is decided from text,
 * numbers and maps, so the applier's rules are testable without a database or a
 * container runtime. `src/app/actions/restore-apply.ts` owns every effect and
 * measures every fact; this module owns every decision about what those facts
 * mean and what SQL they produce.
 *
 * The staging schema lives in the LIVE database and holds the archive's rows
 * for one promote run. Archive row data reaches it through the admin-panel
 * process, because `pg_restore -L` cannot redirect a restore into another
 * schema: its list-file reader takes only the dump id from each line and the
 * SQL it runs for a data item is the archive's own stored COPY statement, which
 * names `public`. See `scratchExportSql` and `stagingLoadSql` for the shape.
 */

import { BACKUP_TABLES, BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';

export { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';

// ---------------------------------------------------------------------------
// Strategies and report shapes
// ---------------------------------------------------------------------------

export type TableStrategy = 'merge' | 'overwrite' | 'skip';
export type ApplyStrategies = Readonly<Record<string, TableStrategy>>;

export const TABLE_STRATEGIES: readonly TableStrategy[] = ['merge', 'overwrite', 'skip'];
export const DEFAULT_STRATEGY: TableStrategy = 'merge';

export interface TableValidateReport {
  readonly table: string;
  readonly strategy: TableStrategy;
  readonly liveRows: number;
  readonly archiveRows: number;
  readonly newEstimate: number;
  readonly warnings: readonly string[];
}

export interface ValidateReport {
  readonly ok: boolean;
  /** The value `promotePreview` requires as its confirmToken. */
  readonly reportId: string;
  readonly generatedAt: string;
  readonly previewId: string;
  readonly stagingSchema: string;
  readonly tableReports: readonly TableValidateReport[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export type TableApplyStatus = 'applied' | 'skipped' | 'failed' | 'pending';

export interface TableApplyRecord {
  readonly table: string;
  readonly strategy: TableStrategy;
  readonly status: TableApplyStatus;
  readonly liveBefore: number;
  readonly liveAfter: number;
  /** Archive rows written: inserted plus updated for merge, inserted for overwrite. */
  readonly merged: number;
  readonly note?: string;
}

export interface PromoteReport {
  readonly ok: boolean;
  readonly previewId: string;
  readonly reportId: string;
  readonly stagingSchema: string;
  /** Manifest `ts` of the full backup taken before anything was written. */
  readonly backupEntry?: string;
  readonly tableRecords: readonly TableApplyRecord[];
  readonly appliedTables: readonly string[];
  readonly pendingTables: readonly string[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function isTableStrategy(value: unknown): value is TableStrategy {
  return typeof value === 'string' && TABLE_STRATEGIES.includes(value as TableStrategy);
}

/** An omitted table means merge, and a name outside the catalog is refused. */
export function normalizeStrategies(strategies: ApplyStrategies): { readonly ok: boolean; readonly resolved: Readonly<Record<string, TableStrategy>>; readonly unknown: readonly string[] } {
  const resolved: Record<string, TableStrategy> = {};
  const unknown: string[] = [];
  for (const table of BACKUP_TABLE_NAMES) {
    const requested = strategies[table];
    if (requested === undefined) {
      resolved[table] = DEFAULT_STRATEGY;
      continue;
    }
    if (!isTableStrategy(requested)) {
      unknown.push(table);
      continue;
    }
    resolved[table] = requested;
  }
  for (const table of Object.keys(strategies)) {
    if (!BACKUP_TABLE_NAMES.includes(table)) unknown.push(table);
  }
  return { ok: unknown.length === 0, resolved, unknown: [...new Set(unknown)].sort() };
}

/** Applied tables in catalog order, which is parent-before-child. */
export function applyOrder(strategies: ApplyStrategies): readonly string[] {
  return BACKUP_TABLES.filter((table) => strategies[table.name] !== 'skip').map((table) => table.name);
}

export function catalogPrimaryKeys(table: string): readonly string[] {
  return BACKUP_TABLES.find((entry) => entry.name === table)?.pk ?? [];
}

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
// Double-confirm binding
// ---------------------------------------------------------------------------

/** A validation older than this is refused: the live database moved on since it was measured. */
export const PROMOTE_TOKEN_TTL_MS = 15 * 60_000;

export function buildReportId(stagingSchema: string, epochMs: number): string {
  if (!isStagingSchemaName(stagingSchema)) throw new Error(`Refusing to build a report id from schema: ${stagingSchema}`);
  return `${stagingSchema}-${epochMs}`;
}

/** The instant a token names, or null when the token is not this preview's report id. */
export function parseReportId(stagingSchema: string, token: unknown): number | null {
  if (!isStagingSchemaName(stagingSchema) || typeof token !== 'string') return null;
  const separator = token.lastIndexOf('-');
  if (separator <= 0) return null;
  if (token.slice(0, separator) !== stagingSchema) return null;
  const epochMs = Number(token.slice(separator + 1));
  if (!Number.isInteger(epochMs) || epochMs <= 0) return null;
  return epochMs;
}

/**
 * Returns the reason the token is refused, or null when the promote may go
 * ahead. A token is only valid for the preview whose staging schema it names and
 * only while that validation is recent, because the live database moves on
 * underneath a measurement.
 */
export function checkConfirmToken(stagingSchema: string, token: unknown, nowMs: number): string | null {
  if (typeof token !== 'string' || token.length === 0) return 'Promote needs the confirm token from a passing validatePromote report.';
  const generatedAtMs = parseReportId(stagingSchema, token);
  if (generatedAtMs === null) return 'Confirm token was not issued for this preview; run validatePromote again.';
  if (nowMs - generatedAtMs > PROMOTE_TOKEN_TTL_MS) return 'Validation report expired; run validatePromote again before promoting.';
  if (generatedAtMs > nowMs) return 'Validation report is dated in the future; run validatePromote again before promoting.';
  return null;
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
// Validation facts and decisions
// ---------------------------------------------------------------------------

export interface ApplyFacts {
  /** False when the preview's scratch container is gone, which removes the only source of archive rows. */
  readonly scratchAlive: boolean;
  /** Tables the archive carries a TABLE DATA entry for. */
  readonly archiveTables: ReadonlySet<string>;
  readonly archiveRows: ReadonlyMap<string, number>;
  readonly archiveColumns: ReadonlyMap<string, readonly string[]>;
  readonly liveRows: ReadonlyMap<string, number>;
  readonly liveColumns: ReadonlyMap<string, readonly string[]>;
  readonly livePkColumns: ReadonlyMap<string, readonly string[]>;
  /** Foreign-key parents of each table, read from the live information_schema. */
  readonly liveFkParents: ReadonlyMap<string, readonly string[]>;
  readonly archiveDigestCount: number;
  readonly archiveDigestBytes: number;
  readonly liveDigestCount: number;
  readonly missingDigestCount: number;
  readonly missingDigestBytes: number;
  readonly databaseSizeBytes: number;
}

export interface ApplyPlan {
  readonly tableReports: readonly TableValidateReport[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const SPACE_WARN_RATIO = 0.1;
/** Row count at which the per-table JSON export is worth warning about before promote. */
export const LARGE_TABLE_ROW_WARN = 50_000;

function countOf(counts: ReadonlyMap<string, number>, table: string): number {
  return counts.get(table) ?? 0;
}

function columnsOf(columns: ReadonlyMap<string, readonly string[]>, table: string): readonly string[] {
  return columns.get(table) ?? [];
}

function missingPrimaryKeys(facts: ApplyFacts, table: string): readonly string[] {
  const live = columnsOf(facts.livePkColumns, table);
  return catalogPrimaryKeys(table).filter((column) => !live.includes(column));
}

function missingArchiveColumns(facts: ApplyFacts, table: string): readonly string[] {
  const archive = columnsOf(facts.archiveColumns, table);
  return columnsOf(facts.liveColumns, table).filter((column) => !archive.includes(column));
}

/** A non-skip table needs every live foreign-key parent to be applied here or to exist live already. */
function absentParents(facts: ApplyFacts, strategies: ApplyStrategies, table: string): readonly string[] {
  return columnsOf(facts.liveFkParents, table).filter(
    (parent) => strategies[parent] === 'skip' && !facts.liveColumns.has(parent),
  );
}

/**
 * Prisma creates this schema's foreign keys as plain non-deferrable
 * constraints, so a per-table overwrite of a parent cannot delete the live
 * rows its applied children still reference. Rejecting the combination keeps
 * one transaction per table without a deferred-constraint assumption that the
 * database does not support.
 */
export function overwriteParentConflicts(facts: ApplyFacts, strategies: ApplyStrategies): readonly string[] {
  const order = applyOrder(strategies);
  const errors: string[] = [];
  for (const table of order) {
    if (strategies[table] !== 'overwrite') continue;
    const children = order.filter((candidate) => columnsOf(facts.liveFkParents, candidate).includes(table));
    if (children.length > 0) {
      errors.push(
        `"${table}" cannot be overwritten while ${children.join(', ')} reference it: this schema's foreign keys are not deferrable, so a per-table delete would break them. Skip ${children.join(', ')} or merge them instead.`,
      );
    }
  }
  return errors;
}

function spaceWarnings(facts: ApplyFacts, strategies: ApplyStrategies): readonly string[] {
  const newRows = applyOrder(strategies).reduce(
    (total, table) => total + Math.max(0, countOf(facts.archiveRows, table) - countOf(facts.liveRows, table)),
    0,
  );
  if (facts.databaseSizeBytes <= 0) {
    return ['Live database size is unknown, so the growth check could not run; free disk space was not verified.'];
  }
  if (newRows * 512 <= facts.databaseSizeBytes * SPACE_WARN_RATIO) return [];
  return [
    `Applying these tables adds roughly ${newRows} row(s) against a ${Math.round(facts.databaseSizeBytes / 1024 / 1024)} MB database; check free disk space before promoting.`,
  ];
}

function fsobjectWarnings(facts: ApplyFacts, strategies: ApplyStrategies): readonly string[] {
  if (strategies[LARGE_OBJECT_TABLE] === 'skip') return [];
  const megabytes = Math.round(facts.missingDigestBytes / 1024 / 1024);
  return [
    `"${LARGE_OBJECT_TABLE}": ${facts.liveDigestCount} of ${facts.archiveDigestCount} archive digest(s) are already live and will reuse their live large object; ${facts.missingDigestCount} digest(s) (about ${megabytes} MB) will have their bytes copied out of scratch container.`,
  ];
}

function adminWarnings(facts: ApplyFacts, strategies: ApplyStrategies): readonly string[] {
  const affected = ADMIN_NULL_TABLES.filter((table) => strategies[table] !== 'skip');
  if (affected.length === 0) return [];
  return [
    `"admins" is never archived, so ${affected.join(', ')} will have "${ADMIN_ID_COLUMN}" set to NULL on every restored row; the column is nullable in the live schema.`,
  ];
}

function tableWarnings(facts: ApplyFacts, table: string, strategies: ApplyStrategies): readonly string[] {
  const warnings: string[] = [];
  const archiveRows = countOf(facts.archiveRows, table);
  const liveRows = countOf(facts.liveRows, table);
  if (strategies[table] === 'overwrite' && archiveRows < liveRows) {
    warnings.push(
      `Overwrite replaces only the ${archiveRows} row(s) the archive carries; the other ${liveRows - archiveRows} live row(s) are left alone.`,
    );
  }
  if (archiveRows >= LARGE_TABLE_ROW_WARN) {
    warnings.push(
      `"${table}" carries ${archiveRows} row(s), which the applier serialises as one document per table; a table this size can exceed the export ceiling and will stop the run before any row is written.`,
    );
  }
  const extra = columnsOf(facts.archiveColumns, table).filter((column) => !columnsOf(facts.liveColumns, table).includes(column));
  if (extra.length > 0) warnings.push(`The archive carries ${extra.length} column(s) the live table no longer has (${extra.slice(0, 5).join(', ')}); they are dropped.`);
  return warnings;
}

/** Read-only phase: every rule that must hold before any live row is written. */
export function planApply(strategies: ApplyStrategies, facts: ApplyFacts): ApplyPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!facts.scratchAlive) {
    errors.push('The preview scratch container is gone, so the archive rows it holds cannot be read.');
  }
  const tableReports: TableValidateReport[] = [];
  for (const table of applyOrder(strategies)) {
    const tableErrors: string[] = [];
    if (!facts.archiveTables.has(table)) tableErrors.push(`The archive carries no rows for "${table}".`);
    const absentPk = missingPrimaryKeys(facts, table);
    if (strategies[table] === 'merge' && absentPk.length > 0) {
      tableErrors.push(`"${table}" is merged, but the live table has no column for primary key ${absentPk.join(', ')}.`);
    }
    const absentColumns = missingArchiveColumns(facts, table);
    if (table !== LARGE_OBJECT_TABLE && absentColumns.length > 0) {
      tableErrors.push(`"${table}" needs live column(s) the archive does not carry: ${absentColumns.join(', ')}.`);
    }
    for (const parent of absentParents(facts, strategies, table)) {
      tableErrors.push(`"${table}" references "${parent}", which is neither applied here nor present live.`);
    }
    errors.push(...tableErrors);
    const archiveRows = countOf(facts.archiveRows, table);
    const liveRows = countOf(facts.liveRows, table);
    const reportWarnings = [
      ...tableWarnings(facts, table, strategies),
      ...(ADMIN_NULL_TABLES.includes(table) && strategies[table] !== 'skip'
        ? [`"${ADMIN_ID_COLUMN}" will be set to NULL on ${archiveRows} restored row(s).`]
        : []),
    ];
    tableReports.push({
      table,
      strategy: strategies[table],
      liveRows,
      archiveRows,
      newEstimate: Math.max(0, archiveRows - liveRows),
      warnings: reportWarnings,
    });
  }
  errors.push(...overwriteParentConflicts(facts, strategies));
  warnings.push(...fsobjectWarnings(facts, strategies), ...adminWarnings(facts, strategies), ...spaceWarnings(facts, strategies));
  if (strategies[LARGE_OBJECT_TABLE] !== 'skip' && !facts.archiveTables.has(LARGE_OBJECT_TABLE)) {
    errors.push(`"${LARGE_OBJECT_TABLE}" is applied but the archive carries no rows for it.`);
  }
  return { tableReports, errors, warnings };
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

export function adminColumnFor(table: string, strategies: ApplyStrategies): string | null {
  return ADMIN_NULL_TABLES.includes(table) && strategies[table] !== 'skip' ? ADMIN_ID_COLUMN : null;
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

export function stagingSchemaTableCountSql(stagingSchema: string): string {
  return `SELECT count(*)::bigint::text FROM information_schema.tables WHERE table_schema = '${stagingSchema}'`;
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

// ---------------------------------------------------------------------------
// Live read-only measurement queries
// ---------------------------------------------------------------------------

/**
 * `tables` is a catalog table list the caller already validated, so it is
 * embedded as a quoted literal list rather than bound as an array: it selects
 * information_schema rows and never interpolates a value.
 */
export function nameListLiteral(tables: readonly string[]): string {
  return tables.map((table) => `'${quoteIdentifier(table).slice(1, -1)}'`).join(', ');
}

export function liveColumnsQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${names}) ORDER BY table_name, ordinal_position`;
}

export function livePrimaryKeyQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT k.table_name, k.column_name FROM information_schema.table_constraints AS c JOIN information_schema.key_column_usage AS k ON k.constraint_name = c.constraint_name AND k.table_schema = c.table_schema WHERE c.table_schema = 'public' AND c.constraint_type = 'PRIMARY KEY' AND c.table_name IN (${names}) ORDER BY k.table_name, k.ordinal_position`;
}

export function liveFkParentQuerySql(tables: readonly string[]): string {
  const names = nameListLiteral(tables);
  return `SELECT DISTINCT child.table_name, parent.table_name AS parent_name FROM information_schema.referential_constraints AS rc JOIN information_schema.key_column_usage AS child ON child.constraint_name = rc.constraint_name AND child.constraint_schema = rc.constraint_schema JOIN information_schema.key_column_usage AS parent ON parent.constraint_name = rc.unique_constraint_name AND parent.constraint_schema = rc.unique_constraint_schema WHERE rc.constraint_schema = 'public' AND child.table_name IN (${names}) ORDER BY child.table_name, parent.table_name`;
}

export function liveDigestQuerySql(): string {
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)}`;
}

export function liveDigestListQuerySql(): string {
  return `SELECT ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)}`;
}

/**
 * Archive-side checks, run against the scratch container. The blob bytes live
 * there, so the integrity and size checks belong to that database: a staging
 * `loid` would name a large object in the live database, which is exactly the
 * assumption this applier refuses to make.
 */
export function archiveDigestIntegritySql(): string {
  return `SELECT count(*)::bigint::text FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE NOT EXISTS (SELECT 1 FROM pg_largeobject AS l WHERE l.loid = f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)})`;
}

export function archiveDigestBytesSql(): string {
  return `SELECT (count(*)::bigint * ${LARGE_OBJECT_CHUNK_BYTES})::bigint::text FROM pg_largeobject AS l WHERE EXISTS (SELECT 1 FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)} = l.loid)`;
}

export function archiveDigestListSql(): string {
  return `SELECT ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} ORDER BY ${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)}`;
}

/** Bytes for one named digest, read out of the scratch container's own large object. */
export function archiveDigestBytesForSql(digest: string): string {
  const escaped = digest.replace(/'/g, "''");
  return `SELECT encode(lo_get(f.${quoteIdentifier(LARGE_OBJECT_OID_COLUMN)}), 'base64') FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} = '${escaped}'`;
}

export function archiveDigestDescriptionSql(digest: string): string {
  const escaped = digest.replace(/'/g, "''");
  return `SELECT coalesce(f.${quoteIdentifier(LARGE_OBJECT_DESCRIPTION_COLUMN)}, '') FROM ${qualifiedTable('public', LARGE_OBJECT_TABLE)} AS f WHERE f.${quoteIdentifier(LARGE_OBJECT_DIGEST_COLUMN)} = '${escaped}'`;
}

export function databaseSizeQuerySql(): string {
  return 'SELECT pg_database_size(current_database())::bigint::text';
}