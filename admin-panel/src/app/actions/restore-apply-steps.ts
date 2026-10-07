/**
 * The writes a promote performs, one phase at a time: the staging load, the
 * per-table transactions, and the large-object copy. Each phase runs its own
 * statements and reports what it committed; the server action owns the order
 * they run in and the report the run produces.
 *
 * Why every export below carries `backup:restore` itself: this directory is
 * scanned as a set of entry points, so a phase the apply server action
 * composes is read as one that can be called on its own. The caller gates the
 * same key, so the repeat check costs one cached session read and never widens
 * or narrows what the caller may already do.
 */

import { ensurePermission } from '@/lib/permissions';
import { LARGE_OBJECT_TABLE, adminColumnFor, archiveDigestBytesForSql, archiveDigestDescriptionSql, archiveDigestListSql, catalogPrimaryKeys, countRowsSql, createStagingSchemaSql, createStagingTableSql, deleteDigestBatchSql, dropStagingSchemaSql, insertSelectSql, liveDigestQuerySql, mergeInsertSql, overwriteDeleteSql, relayTable, stagingNewRowCountSql } from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, LargeObjectCopy, RelayPage, TableApplyRecord, TableStrategy } from '@/lib/restore-apply';
import { blobBatchFits, blobBatchInsertSql, blobRowBytes, runStagingLoad, runTableTransaction } from '@/lib/restore-apply-runner';
import type { LiveStatementRunner } from '@/lib/restore-apply-runner';
import type { PromoteProgressWriter } from '@/lib/restore-apply-progress';
import { DOCKER_TIMEOUT_MS, lines, liveCount, liveDigestSet, runLiveSql } from './restore-apply-measure';
import type { LiveDatabaseEnv } from './restore-apply-measure';
import { describeFailure, scratchQuery, settle } from './restore-preview-run';

/** Per-transaction budget for one table's merge. */
export const APPLY_STATEMENT_TIMEOUT_MS = 600_000;

/**
 * How the statements below reach the live database. A caller that supplies its
 * own runner replaces every one of them, which is what lets the statements an
 * apply builds be run and inspected without a container.
 */
function dockerStatementRunner(env: LiveDatabaseEnv): LiveStatementRunner {
  return { runSql: (sql, timeoutMs) => runLiveSql(env, sql, timeoutMs), runCount: (sql) => liveCount(env, sql) };
}

// ---------------------------------------------------------------------------
// Staging load
// ---------------------------------------------------------------------------

/**
 * Loads one table's archive rows into its staging table. The rows leave the
 * scratch container and re-enter the live database through this process, because
 * `pg_restore -L` cannot redirect a restore into another schema; keyset paging
 * bounded by bytes is what keeps every page inside one `psql -c` argument, so
 * any table size streams through memory that never grows with it.
 */
async function loadStagingTable(container: string, runner: LiveStatementRunner, staging: string, table: string, columns: readonly string[]): Promise<void> {
  await relayTable(
    (page) => readStagingPage(container, page),
    (batch) => runStagingLoad(runner, staging, table, columns, batch.payload, APPLY_STATEMENT_TIMEOUT_MS),
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

/**
 * Drops any staging schema left by an earlier attempt before rebuilding it, so
 * a retried promote starts from a clean staging area rather than failing on a
 * name that is already taken.
 *
 * `fsobjects` is not staged: its digest list and its bytes are both read from
 * the scratch container, and a content-addressed table can carry one row per
 * stored file, so staging it would page rows nothing reads back.
 *
 * Each table is announced as it is staged and never counted as done: rows in a
 * staging table have committed to nothing live yet.
 */
export async function loadStaging(
  container: string,
  env: LiveDatabaseEnv,
  staging: string,
  order: readonly string[],
  facts: ApplyFacts,
  progress: PromoteProgressWriter,
): Promise<void> {
  await ensurePermission('backup:restore');
  const runner = dockerStatementRunner(env);
  await runner.runSql(dropStagingSchemaSql(staging), DOCKER_TIMEOUT_MS);
  await runner.runSql(createStagingSchemaSql(staging), DOCKER_TIMEOUT_MS);
  for (const table of order.filter((name) => name !== LARGE_OBJECT_TABLE)) {
    await progress.starting(table);
    await runner.runSql(createStagingTableSql(staging, table), DOCKER_TIMEOUT_MS);
    const columns = (facts.liveColumns.get(table) ?? []).filter((column) => (facts.archiveColumns.get(table) ?? []).includes(column));
    await loadStagingTable(container, runner, staging, table, columns);
  }
}

/**
 * The staging schema is dropped whatever happened. A failure here is reported
 * alongside the run rather than swallowed: leftover staging rows are harmless
 * but they are disk the operator should know is still there.
 */
export async function dropStaging(staging: string, env: LiveDatabaseEnv): Promise<string | null> {
  await ensurePermission('backup:restore');
  const dropped = await settle(dockerStatementRunner(env).runSql(dropStagingSchemaSql(staging), DOCKER_TIMEOUT_MS));
  return dropped.ok ? null : `Staging schema ${staging} could not be dropped: ${describeFailure(dropped.error)}`;
}

// ---------------------------------------------------------------------------
// Per-table transactions
// ---------------------------------------------------------------------------

/**
 * One table, one transaction, because a merge is an upsert on the primary key:
 * an archive row that collides with a live row updates it and one that does not
 * inserts, so the whole table is one all-or-nothing statement pair. Merge
 * leaves live rows the archive does not carry alone, and overwrite deletes the
 * rows it is about to replace inside the same transaction. The row count
 * afterwards must equal what the strategy promised, or the transaction is
 * rolled back rather than reported as applied.
 *
 * Restored rows are written with the promoting column set to NULL, because an
 * archive's own `admin_id` names an account that must not be resurrected as the
 * author of a row, and a single-column key has its sequence advanced inside the
 * same transaction so the next live key cannot collide with a restored one; a
 * composite key has no sequence to advance and says so in the note.
 */
export async function applyOneTable(
  env: LiveDatabaseEnv,
  staging: string,
  table: string,
  strategy: TableStrategy,
  strategies: ApplyStrategies,
  facts: ApplyFacts,
  runner: LiveStatementRunner = dockerStatementRunner(env),
): Promise<TableApplyRecord> {
  await ensurePermission('backup:restore');
  const pkColumns = catalogPrimaryKeys(table);
  const adminColumn = adminColumnFor(table, strategies);
  const stagingRows = await runner.runCount(countRowsSql(staging, table));
  const newRows = await runner.runCount(stagingNewRowCountSql(staging, table, pkColumns));
  const liveBefore = await runner.runCount(countRowsSql('public', table));
  const expectedAfter = strategy === 'overwrite' ? liveBefore - (stagingRows - newRows) + stagingRows : liveBefore + newRows;
  const columns = facts.liveColumns.get(table) ?? [];
  const statements = strategy === 'overwrite' ? [overwriteDeleteSql(staging, table, pkColumns), insertSelectSql(table, staging, columns, adminColumn)] : [mergeInsertSql(table, staging, columns, pkColumns, adminColumn)];
  await runTableTransaction(runner, {
    table,
    statements,
    pkColumns,
    expectedAfter,
    statementTimeoutMs: APPLY_STATEMENT_TIMEOUT_MS,
    queryTimeoutMs: DOCKER_TIMEOUT_MS,
    runTimeoutMs: APPLY_STATEMENT_TIMEOUT_MS + DOCKER_TIMEOUT_MS,
  });
  const liveAfter = await runner.runCount(countRowsSql('public', table));
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
  runner: LiveStatementRunner = dockerStatementRunner(env),
): Promise<TableApplyRecord> {
  await ensurePermission('backup:restore');
  const liveBefore = await runner.runCount(liveDigestQuerySql());
  const digests = lines(await scratchQuery(container, archiveDigestListSql()));
  const liveDigests = await liveDigestSet();
  const wanted = strategy === 'overwrite' ? digests : digests.filter((digest) => !liveDigests.has(digest));
  const copied = await copyBlobBatches(container, runner, strategy, wanted);
  const liveAfter = await runner.runCount(liveDigestQuerySql());
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

/**
 * Copies the wanted blobs, flushed on the bytes a batch has accumulated rather
 * than on a row count, because every flush becomes one `psql -c` argument: one
 * large file must not push a batch past what a single argument can carry. An
 * overwrite deletes the live rows of each batch immediately before inserting it
 * back, so no live blob is ever missing for longer than its own statement.
 */
async function copyBlobBatches(container: string, runner: LiveStatementRunner, strategy: TableStrategy, digests: readonly string[]): Promise<number> {
  let copied = 0;
  let rows: LargeObjectCopy[] = [];
  let bytes = 0;
  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    if (strategy === 'overwrite') {
      await runner.runSql(`BEGIN;\n${deleteDigestBatchSql(rows.map((row) => row.digest))};\nCOMMIT;\n`, APPLY_STATEMENT_TIMEOUT_MS);
    }
    await runner.runSql(blobBatchInsertSql(rows), APPLY_STATEMENT_TIMEOUT_MS);
    copied += rows.length;
    rows = [];
    bytes = 0;
  };
  for (const digest of digests) {
    const row = await readBlobRow(container, digest);
    if (rows.length > 0 && !blobBatchFits(bytes, row)) await flush();
    rows.push(row);
    bytes += blobRowBytes(row);
  }
  await flush();
  return copied;
}

/** One blob's base64 bytes and description, read out of the scratch container. */
async function readBlobRow(container: string, digest: string): Promise<LargeObjectCopy> {
  const [encoded, description] = await Promise.all([
    scratchQuery(container, archiveDigestBytesForSql(digest)),
    scratchQuery(container, archiveDigestDescriptionSql(digest)),
  ]);
  return { digest, encoded: encoded.trim(), description: description.trim() };
}