/**
 * The read-only decisions the applier makes before a live row is written: which
 * tables apply, in what order, against which key, which rules the measured facts
 * break, and whether a confirmation token still describes this preview.
 *
 * No docker, no Prisma, no filesystem: every rule here is decided from text,
 * numbers and maps, so the applier's refusal rules are testable without a
 * database or a container runtime. The statements these decisions drive live in
 * `restore-apply-sql.ts` and `restore-apply-sql-queries.ts`.
 */

import { BACKUP_TABLES } from '@/lib/backup-table-catalog';
import { ADMIN_ID_COLUMN, ADMIN_NULL_TABLES, LARGE_OBJECT_TABLE, isStagingSchemaName } from '@/lib/restore-apply-sql';
import type { ApplyStrategies, TableValidateReport } from '@/lib/restore-apply';

// ---------------------------------------------------------------------------
// Apply order and primary keys
// ---------------------------------------------------------------------------

/** Applied tables in catalog order, which is parent-before-child. */
export function applyOrder(strategies: ApplyStrategies): readonly string[] {
  return BACKUP_TABLES.filter((table) => strategies[table.name] !== 'skip').map((table) => table.name);
}

export function catalogPrimaryKeys(table: string): readonly string[] {
  return BACKUP_TABLES.find((entry) => entry.name === table)?.pk ?? [];
}

export function adminColumnFor(table: string, strategies: ApplyStrategies): string | null {
  return ADMIN_NULL_TABLES.includes(table) && strategies[table] !== 'skip' ? ADMIN_ID_COLUMN : null;
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
/** Row count at which a table is worth warning about before promote; the relay pages any table size, so nothing stops. */
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
      `"${table}" carries ${archiveRows} row(s); the applier relays them in chunks, so this costs a longer promote rather than a refused run. The ceiling it reports is per chunk, not per table.`,
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