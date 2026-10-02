/**
 * The writes a promote performs, one phase at a time: the staging load, the
 * per-table transactions, and the large-object copy. Each phase runs its own
 * statements and reports what it committed; the server action owns the order
 * they run in and the report the run produces.
 */

import { LARGE_OBJECT_TABLE, adminColumnFor, archiveDigestBytesForSql, archiveDigestDescriptionSql, archiveDigestListSql, catalogPrimaryKeys, countRowsSql, createStagingSchemaSql, createStagingTableSql, deleteDigestBatchSql, dropStagingSchemaSql, fsobjectInsertSql, insertSelectSql, liveDigestQuerySql, mergeInsertSql, overwriteDeleteSql, qualifiedTable, relayTable, sequenceNameQuerySql, sequenceResetSql, setLocalTimeoutSql, stagingLoadSql, stagingNewRowCountSql } from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, LargeObjectCopy, RelayBatch, RelayPage, TableApplyRecord, TableStrategy } from '@/lib/restore-apply';
import { DOCKER_TIMEOUT_MS, countFrom, lines, liveCount, liveDigestSet, runLiveSql } from './restore-apply-measure';
import type { LiveDatabaseEnv } from './restore-apply-measure';
import { describeFailure, scratchQuery, settle } from './restore-preview-run';

/** Per-transaction budget for one table's merge. */
export const APPLY_STATEMENT_TIMEOUT_MS = 600_000;
/**
 * Bounded per chunk rather than per table, so an oversized table is paged
 * instead of refused. This matches the shared docker runner's stdout cap, which
 * the relay stays inside by paging; a chunk that would exceed it is reported
 * here as an actionable message instead of arriving as an opaque exec error.
 */
export const MAX_TABLE_EXPORT_BYTES = 8 * 1024 * 1024;
const LARGE_OBJECT_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Staging load
// ---------------------------------------------------------------------------

/**
 * Loads one table's archive rows into its staging table. The rows leave the
 * scratch container and re-enter the live database through this process, because
 * `pg_restore -L` cannot redirect a restore into another schema; keyset paging
 * is what bounds that transport, so any table size streams through memory that
 * never grows with it.
 */
async function loadStagingTable(container: string, env: LiveDatabaseEnv, staging: string, table: string, columns: readonly string[]): Promise<void> {
  await relayTable(
    (page) => readStagingPage(container, page),
    (batch) => writeStagingBatch(env, staging, table, columns, batch),
    { table, columns, pkColumns: catalogPrimaryKeys(table) },
  );
}

async function readStagingPage(container: string, page: RelayPage): Promise<string> {
  try {
    return await scratchQuery(container, page.sql, page.timeoutMs);
  } catch (error) {
    throw new Error(`"${page.table}" could not be read out of the scratch container: ${describeFailure(error)}`);
  }
}

async function writeStagingBatch(env: LiveDatabaseEnv, staging: string, table: string, columns: readonly string[], batch: RelayBatch): Promise<void> {
  if (Buffer.byteLength(batch.payload) > MAX_TABLE_EXPORT_BYTES) {
    throw new Error(`"${table}" serialises a chunk of ${batch.rows} row(s) to more than the ${MAX_TABLE_EXPORT_BYTES} byte ceiling one chunk may carry.`);
  }
  await runLiveSql(env, stagingLoadSql(staging, table, columns).replace('$1::json', `'${batch.payload.replace(/'/g, "''")}'::json`), APPLY_STATEMENT_TIMEOUT_MS);
}

/**
 * Drops any staging schema left by an earlier attempt before rebuilding it, so
 * a retried promote starts from a clean staging area rather than failing on a
 * name that is already taken.
 *
 * `fsobjects` is not staged: its digest list and its bytes are both read from
 * the scratch container, and a content-addressed table can carry one row per
 * stored file, so staging it would page rows nothing reads back.
 */
export async function loadStaging(
  container: string,
  env: LiveDatabaseEnv,
  staging: string,
  order: readonly string[],
  facts: ApplyFacts,
): Promise<void> {
  await runLiveSql(env, dropStagingSchemaSql(staging), DOCKER_TIMEOUT_MS);
  await runLiveSql(env, createStagingSchemaSql(staging), DOCKER_TIMEOUT_MS);
  for (const table of order.filter((name) => name !== LARGE_OBJECT_TABLE)) {
    await runLiveSql(env, createStagingTableSql(staging, table), DOCKER_TIMEOUT_MS);
    const columns = (facts.liveColumns.get(table) ?? []).filter((column) => (facts.archiveColumns.get(table) ?? []).includes(column));
    await loadStagingTable(container, env, staging, table, columns);
  }
}

/**
 * The staging schema is dropped whatever happened. A failure here is reported
 * alongside the run rather than swallowed: leftover staging rows are harmless
 * but they are disk the operator should know is still there.
 */
export async function dropStaging(staging: string, env: LiveDatabaseEnv): Promise<string | null> {
  const dropped = await settle(runLiveSql(env, dropStagingSchemaSql(staging), DOCKER_TIMEOUT_MS));
  return dropped.ok ? null : `Staging schema ${staging} could not be dropped: ${describeFailure(dropped.error)}`;
}

// ---------------------------------------------------------------------------
// Per-table transactions
// ---------------------------------------------------------------------------

/**
 * One table, one transaction. The statement timeout is local to it, so a
 * stalled merge rolls that table back and leaves every earlier commit in place.
 * The row count afterwards must equal what the strategy promised, or the
 * transaction is rolled back rather than reported as applied.
 */
export async function applyOneTable(
  env: LiveDatabaseEnv,
  staging: string,
  table: string,
  strategy: TableStrategy,
  strategies: ApplyStrategies,
  facts: ApplyFacts,
): Promise<TableApplyRecord> {
  const pkColumns = catalogPrimaryKeys(table);
  const adminColumn = adminColumnFor(table, strategies);
  const stagingRows = await liveCount(env, countRowsSql(staging, table));
  const newRows = await liveCount(env, stagingNewRowCountSql(staging, table, pkColumns));
  const liveBefore = await liveCount(env, countRowsSql('public', table));
  const expectedAfter = strategy === 'overwrite' ? liveBefore - (stagingRows - newRows) + stagingRows : liveBefore + newRows;
  await runLiveSql(env, `${await tableTransactionBody(env, staging, table, strategy, strategies, facts, pkColumns, adminColumn, expectedAfter)}\n`, APPLY_STATEMENT_TIMEOUT_MS + DOCKER_TIMEOUT_MS);
  const liveAfter = await liveCount(env, countRowsSql('public', table));
  if (liveAfter !== expectedAfter) {
    throw new Error(`"${table}" ended with ${liveAfter} live row(s) where ${expectedAfter} were expected.`);
  }
  return {
    table,
    strategy,
    status: 'applied',
    liveBefore,
    liveAfter,
    merged: stagingRows,
    ...tableNote(table, strategy, stagingRows, adminColumn, pkColumns),
  };
}

/**
 * The sequence reset is resolved before the transaction opens and runs inside
 * it, so a key that cannot be advanced rolls the table back rather than leaving
 * it committed with a sequence that would hand out a colliding id.
 */
async function sequenceResetStatements(env: LiveDatabaseEnv, table: string, pkColumns: readonly string[]): Promise<readonly string[]> {
  if (pkColumns.length !== 1) return [];
  const sequenceName = (await runLiveSql(env, sequenceNameQuerySql(table, pkColumns[0]), DOCKER_TIMEOUT_MS)).trim();
  const sql = sequenceResetSql(table, pkColumns[0], sequenceName.length > 0 ? sequenceName : null);
  return sql === null ? [] : [`${sql};`];
}

/**
 * The whole transaction for one table. The trailing assertion raises a division
 * by zero when the row count is not the one the strategy promised, which rolls
 * the table back instead of reporting it as applied.
 */
async function tableTransactionBody(
  env: LiveDatabaseEnv,
  staging: string,
  table: string,
  strategy: TableStrategy,
  strategies: ApplyStrategies,
  facts: ApplyFacts,
  pkColumns: readonly string[],
  adminColumn: string | null,
  expectedAfter: number,
): Promise<string> {
  const columns = facts.liveColumns.get(table) ?? [];
  const statements =
    strategy === 'overwrite'
      ? [overwriteDeleteSql(staging, table, pkColumns), insertSelectSql(table, staging, columns, adminColumn)]
      : [mergeInsertSql(table, staging, columns, pkColumns, adminColumn)];
  return [
    'BEGIN',
    `${setLocalTimeoutSql(APPLY_STATEMENT_TIMEOUT_MS)};`,
    ...statements,
    ...(await sequenceResetStatements(env, table, pkColumns)),
    `SELECT CASE WHEN (SELECT count(*) FROM ${qualifiedTable('public', table)}) = ${expectedAfter} THEN 1 ELSE 1 / 0 END`,
    'COMMIT',
  ].join('\n');
}

function tableNote(table: string, strategy: TableStrategy, stagingRows: number, adminColumn: string | null, pkColumns: readonly string[]): { readonly note?: string } {
  const notes: string[] = [];
  if (adminColumn !== null) notes.push(`${adminColumn} set to NULL on ${stagingRows} restored row(s)`);
  if (strategy === 'overwrite') notes.push(`replaced ${stagingRows} live row(s) the archive carries`);
  if (pkColumns.length !== 1) notes.push('composite key, so no sequence was advanced');
  return notes.length === 0 ? {} : { note: notes.join('; ') };
}

// ---------------------------------------------------------------------------
// Large objects
// ---------------------------------------------------------------------------

/**
 * Large objects are content-addressed, so a merge copies bytes only for digests
 * live has never seen and leaves the rest of the table alone. Each copied blob
 * is written with `lo_from_bytea`, which mints a live oid; the archive's own oid
 * is never reused because it names a large object in the scratch database.
 */
export async function applyLargeObjects(
  container: string,
  env: LiveDatabaseEnv,
  strategy: TableStrategy,
): Promise<TableApplyRecord> {
  const liveBefore = await countFrom(await runLiveSql(env, liveDigestQuerySql(), DOCKER_TIMEOUT_MS));
  const digests = lines(await scratchQuery(container, archiveDigestListSql()));
  const liveDigests = await liveDigestSet();
  const wanted = strategy === 'overwrite' ? digests : digests.filter((digest) => !liveDigests.has(digest));
  let copied = 0;
  for (const batch of batches(wanted)) {
    if (strategy === 'overwrite') {
      await runLiveSql(env, `BEGIN;\n${deleteDigestBatchSql(batch)};\nCOMMIT;\n`, APPLY_STATEMENT_TIMEOUT_MS);
    }
    copied += await copyBlobBatch(container, env, batch);
  }
  const liveAfter = await countFrom(await runLiveSql(env, liveDigestQuerySql(), DOCKER_TIMEOUT_MS));
  return {
    table: LARGE_OBJECT_TABLE,
    strategy,
    status: 'applied',
    liveBefore,
    liveAfter,
    merged: copied,
    note: strategy === 'overwrite'
      ? `replaced ${digests.length} live digest(s) and copied ${copied} blob(s)`
      : `reused ${digests.length - copied} live large object(s) and copied ${copied} blob(s)`,
  };
}

/** Blob bytes transit this process, so the digest list is copied in bounded batches. */
function* batches(items: readonly string[]): Generator<string[]> {
  for (let start = 0; start < items.length; start += LARGE_OBJECT_BATCH_SIZE) {
    yield items.slice(start, start + LARGE_OBJECT_BATCH_SIZE);
  }
}

async function copyBlobBatch(container: string, env: LiveDatabaseEnv, digests: readonly string[]): Promise<number> {
  const rows: LargeObjectCopy[] = [];
  for (const digest of digests) {
    const [encoded, description] = await Promise.all([
      scratchQuery(container, archiveDigestBytesForSql(digest)),
      scratchQuery(container, archiveDigestDescriptionSql(digest)),
    ]);
    rows.push({ digest, encoded: encoded.trim(), description: description.trim() });
  }
  await runLiveSql(env, `BEGIN;\n${fsobjectInsertSql(rows)};\nCOMMIT;\n`, APPLY_STATEMENT_TIMEOUT_MS);
  return rows.length;
}