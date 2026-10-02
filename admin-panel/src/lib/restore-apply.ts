/**
 * Pure restore-apply logic: the strategy and report vocabulary the applier and
 * its server actions agree on, and the decisions about what the measured facts
 * mean.
 *
 * No docker, no Prisma, no filesystem: everything reachable from here is decided
 * from text, numbers and maps, so the applier's rules are testable without a
 * database or a container runtime. `src/app/actions/restore-apply.ts` owns every
 * effect and measures every fact.
 *
 * The statements live in `restore-apply-sql.ts` and its read-only companion
 * `restore-apply-sql-queries.ts`; the validation decisions live in
 * `restore-apply-plan.ts`. Both are re-exported here, so this module remains the
 * one path every consumer imports from.
 */

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';

export { qualifiedTable, quoteIdentifier } from '@/lib/restore-preview';

// The applier's statements and the identities they are built from.
export {
  ADMIN_ID_COLUMN,
  ADMIN_NULL_TABLES,
  LARGE_OBJECT_CHUNK_BYTES,
  LARGE_OBJECT_DESCRIPTION_COLUMN,
  LARGE_OBJECT_DIGEST_COLUMN,
  LARGE_OBJECT_OID_COLUMN,
  LARGE_OBJECT_TABLE,
  STAGING_SCHEMA_PREFIX,
  countRowsSql,
  createStagingSchemaSql,
  createStagingTableSql,
  deleteDigestBatchSql,
  dropStagingSchemaSql,
  fsobjectInsertSql,
  insertSelectSql,
  isStagingSchemaName,
  mergeInsertSql,
  overwriteDeleteSql,
  scratchColumnsSql,
  scratchExportSql,
  sequenceNameQuerySql,
  sequenceResetSql,
  setLocalTimeoutSql,
  stagingLoadSql,
  stagingNewRowCountSql,
  stagingSchemaName,
} from '@/lib/restore-apply-sql';
export type { LargeObjectCopy } from '@/lib/restore-apply-sql';

// The read-only measurements the validation decisions are made from.
export {
  archiveDigestBytesForSql,
  archiveDigestBytesSql,
  archiveDigestDescriptionSql,
  archiveDigestIntegritySql,
  archiveDigestListSql,
  databaseSizeQuerySql,
  liveColumnsQuerySql,
  liveDigestListQuerySql,
  liveDigestQuerySql,
  liveFkParentQuerySql,
  livePrimaryKeyQuerySql,
  nameListLiteral,
  stagingSchemaTableCountSql,
} from '@/lib/restore-apply-sql-queries';

// The rules that must hold before any live row is written.
export {
  LARGE_TABLE_ROW_WARN,
  PROMOTE_TOKEN_TTL_MS,
  adminColumnFor,
  applyOrder,
  buildReportId,
  catalogPrimaryKeys,
  checkConfirmToken,
  overwriteParentConflicts,
  parseReportId,
  planApply,
} from '@/lib/restore-apply-plan';
export type { ApplyFacts, ApplyPlan } from '@/lib/restore-apply-plan';

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