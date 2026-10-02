'use server';

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Prisma } from '@prisma/client';

import { getBackupRoot } from '@/lib/backup-archives';
import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { isPreviewId, previewContainerName, scratchDatabaseEnv } from '@/lib/restore-preview-store';
import {
  LARGE_OBJECT_TABLE,
  adminColumnFor,
  applyOrder,
  archiveDigestBytesForSql,
  archiveDigestBytesSql,
  archiveDigestDescriptionSql,
  archiveDigestIntegritySql,
  archiveDigestListSql,
  buildReportId,
  catalogPrimaryKeys,
  checkConfirmToken,
  countRowsSql,
  createStagingSchemaSql,
  createStagingTableSql,
  databaseSizeQuerySql,
  deleteDigestBatchSql,
  dropStagingSchemaSql,
  fsobjectInsertSql,
  insertSelectSql,
  liveColumnsQuerySql,
  liveDigestListQuerySql,
  liveDigestQuerySql,
  liveFkParentQuerySql,
  livePrimaryKeyQuerySql,
  mergeInsertSql,
  normalizeStrategies,
  overwriteDeleteSql,
  planApply,
  qualifiedTable,
  scratchExportSql,
  sequenceNameQuerySql,
  sequenceResetSql,
  setLocalTimeoutSql,
  stagingLoadSql,
  stagingNewRowCountSql,
  stagingSchemaName,
} from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, LargeObjectCopy, PromoteReport, TableApplyRecord, TableStrategy, ValidateReport } from '@/lib/restore-apply';
import { describeFailure, readToc, runDocker, scratchQuery, settle } from './restore-preview-run';

const execFileAsync = promisify(execFile);

const MONITOR_CONTAINER = 'cms-monitor';
const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';
const MANIFEST_FILE = 'manifest.json';
const LIVE_CONTAINER = 'cms-database';
const PROMOTE_CONSOLE_COLOR = 16711680;

/**
 * The gate that makes a promote recoverable: one full backup must land in the
 * manifest before any live row is written. Bounded on purpose, and a timeout
 * aborts rather than proceeding on an assumption about the run.
 */
export const PRE_PROMOTE_BACKUP_TIMEOUT_MS = 900_000;
export const PRE_PROMOTE_BACKUP_POLL_MS = 10_000;
/** Per-transaction budget for one table's merge. */
export const APPLY_STATEMENT_TIMEOUT_MS = 600_000;
/**
 * Bounded so an oversized table fails loudly instead of exhausting the panel.
 * This matches the shared docker runner's stdout cap, so the ceiling is the same
 * one `scratchQuery` already enforces and the failure is reported here as an
 * actionable message instead of arriving as an opaque exec error.
 */
export const MAX_TABLE_EXPORT_BYTES = 8 * 1024 * 1024;
const DOCKER_TIMEOUT_MS = 60_000;
const DOCKER_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const LARGE_OBJECT_BATCH_SIZE = 200;

interface LiveDatabaseEnv {
  readonly POSTGRES_USER: string;
  readonly POSTGRES_PASSWORD: string;
  readonly POSTGRES_DB: string;
}

function liveDatabaseEnv(): LiveDatabaseEnv {
  const scratch = scratchDatabaseEnv();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  if (password === undefined || password.length === 0) {
    throw new Error('POSTGRES_PASSWORD is not set, so the promote cannot write to the live database.');
  }
  return { POSTGRES_USER: scratch.POSTGRES_USER, POSTGRES_PASSWORD: password, POSTGRES_DB: scratch.POSTGRES_DB };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lines(stdout: string): string[] {
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

async function countFrom(value: string): Promise<number> {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) throw new Error(`Expected a numeric value, got: ${value}`);
  return parsed;
}

/** A `table`+`value` row set grouped by table, as the measurement queries return it. */
function groupByTable(rows: readonly { table: string; value: string }[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const existing = grouped.get(row.table) ?? [];
    existing.push(row.value);
    grouped.set(row.table, existing);
  }
  return grouped;
}

async function liveGrouped(build: (tables: readonly string[]) => string, tables: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.$queryRaw<{ table: string; value: string }[]>(Prisma.sql`${Prisma.raw(build(tables))}`);
  return groupByTable(rows);
}

async function liveScalar(sql: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`${Prisma.raw(sql)}`);
  return countFrom(rows[0]?.value ?? '0');
}

async function liveRowCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of BACKUP_TABLE_NAMES) {
    const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`${Prisma.raw(countRowsSql('public', table))}`);
    counts.set(table, await countFrom(rows[0]?.value ?? '0'));
  }
  return counts;
}

async function scratchRowCounts(container: string, order: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of order) {
    counts.set(table, await countFrom(await scratchQuery(container, countRowsSql('public', table))));
  }
  return counts;
}

async function scratchColumns(container: string, order: readonly string[]): Promise<Map<string, string[]>> {
  const columns = new Map<string, string[]>();
  for (const table of order) {
    columns.set(table, lines(await scratchQuery(container, scratchColumnsQuery(table))));
  }
  return columns;
}

function scratchColumnsQuery(table: string): string {
  return `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`;
}

async function liveDigestSet(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`${Prisma.raw(liveDigestListQuerySql())}`);
  return new Set(rows.map((row) => row.value));
}

/**
 * Byte volume for the digests live has never seen, measured in the scratch
 * container because that is where those bytes actually are.
 */
async function scratchDigestBytes(container: string, digests: readonly string[]): Promise<number> {
  let total = 0;
  for (const digest of digests) {
    const encoded = (await scratchQuery(container, archiveDigestBytesForSql(digest))).trim();
    total += (Buffer.byteLength(encoded, 'base64'));
  }
  return total;
}

async function measureDigests(container: string, strategies: ApplyStrategies): Promise<Pick<ApplyFacts, 'archiveDigestCount' | 'archiveDigestBytes' | 'liveDigestCount' | 'missingDigestCount' | 'missingDigestBytes'>> {
  const empty = { archiveDigestCount: 0, archiveDigestBytes: 0, liveDigestCount: 0, missingDigestCount: 0, missingDigestBytes: 0 };
  if (strategies[LARGE_OBJECT_TABLE] === 'skip') return empty;
  const archiveDigests = lines(await scratchQuery(container, archiveDigestListSql()));
  const liveDigests = await liveDigestSet();
  const missing = archiveDigests.filter((digest) => !liveDigests.has(digest));
  const [archiveBytes, liveDigestCount, copyBytes] = await Promise.all([
    countFrom(await scratchQuery(container, archiveDigestBytesSql())),
    liveScalar(liveDigestQuerySql()),
    missing.length === 0 ? Promise.resolve(0) : scratchDigestBytes(container, missing),
  ]);
  return { archiveDigestCount: archiveDigests.length, archiveDigestBytes: archiveBytes, liveDigestCount, missingDigestCount: missing.length, missingDigestBytes: copyBytes };
}

async function measureFacts(container: string, strategies: ApplyStrategies, order: readonly string[]): Promise<ApplyFacts> {
  const toc = await readToc(container);
  const [liveColumns, livePkColumns, liveFkParents, liveRows, archiveRows, archiveColumns, databaseSizeBytes, digests] = await Promise.all([
    liveGrouped(liveColumnsQuerySql, BACKUP_TABLE_NAMES),
    liveGrouped(livePrimaryKeyQuerySql, BACKUP_TABLE_NAMES),
    liveGrouped(liveFkParentQuerySql, BACKUP_TABLE_NAMES),
    liveRowCounts(),
    scratchRowCounts(container, order),
    scratchColumns(container, order),
    liveScalar(databaseSizeQuerySql()),
    measureDigests(container, strategies),
  ]);
  return { scratchAlive: true, archiveTables: new Set(toc.catalogTables), archiveRows, archiveColumns, liveRows, liveColumns, livePkColumns, liveFkParents, ...digests, databaseSizeBytes };
}

/** Archive blobs must be self-consistent in the scratch container before any byte is copied. */
async function assertArchiveBlobsIntact(container: string, strategies: ApplyStrategies): Promise<void> {
  if (strategies[LARGE_OBJECT_TABLE] === 'skip') return;
  const dangling = await countFrom(await scratchQuery(container, archiveDigestIntegritySql()));
  if (dangling > 0) {
    throw new Error(
      `The archive's ${LARGE_OBJECT_TABLE} has ${dangling} row(s) whose large object is missing from the scratch container, so their bytes cannot be copied. Promote without ${LARGE_OBJECT_TABLE} or re-upload the archive.`,
    );
  }
}

function emptyReport(previewId: string, staging: string, reportId: string, generatedAtMs: number, errors: readonly string[]): ValidateReport {
  return { ok: false, reportId, generatedAt: new Date(generatedAtMs).toISOString(), previewId, stagingSchema: staging, tableReports: [], errors, warnings: [] };
}

/**
 * Read-only phase. The live database is only measured, the scratch container is
 * only read, and the result is the report whose `reportId` the operator must
 * confirm with before `promotePreview` will write anything.
 */
export async function validatePromote(previewId: string, strategies: ApplyStrategies): Promise<ValidateReport> {
  await ensurePermission('all');
  const generatedAtMs = Date.now();
  const staging = isPreviewId(previewId) ? stagingSchemaName(previewId) : 'restore_staging_00000000';
  const reportId = buildReportId(staging, generatedAtMs);
  const fail = (errors: readonly string[]): ValidateReport => emptyReport(previewId, staging, reportId, generatedAtMs, errors);
  if (!isPreviewId(previewId)) return fail(['Unknown preview id.']);
  const { ok, resolved, unknown } = normalizeStrategies(strategies ?? {});
  if (!ok) return fail([`Not a catalog table or not a valid strategy: ${unknown.join(', ')}`]);
  const order = applyOrder(resolved);
  if (order.length === 0) return fail(['Every table is skipped, so there is nothing to promote.']);
  const container = previewContainerName(previewId);
  const alive = await settle(runDocker(['exec', container, 'true']));
  if (!alive.ok) {
    return fail([`Scratch container ${container} is gone, so the archive rows it holds cannot be read. Start the preview again.`]);
  }
  try {
    const facts = await measureFacts(container, resolved, order);
    const plan = planApply(resolved, facts);
    return {
      ok: plan.errors.length === 0,
      reportId,
      generatedAt: new Date(generatedAtMs).toISOString(),
      previewId,
      stagingSchema: staging,
      tableReports: plan.tableReports,
      errors: plan.errors,
      warnings: plan.warnings,
    };
  } catch (error) {
    return fail([`Validation could not measure the live database: ${describeFailure(error)}`]);
  }
}

// ---------------------------------------------------------------------------
// Pre-promote backup gate
// ---------------------------------------------------------------------------

interface ManifestEntry {
  readonly ts?: unknown;
  readonly kind?: unknown;
}

async function readManifestEntries(): Promise<readonly string[]> {
  const text = await readFile(path.join(getBackupRoot(), MANIFEST_FILE), 'utf8');
  const parsed: unknown = JSON.parse(text);
  const list: readonly ManifestEntry[] = Array.isArray(parsed) ? parsed : [parsed as ManifestEntry];
  return list.map((entry) => (typeof entry.ts === 'string' ? `${entry.kind ?? 'full'}:${entry.ts}` : '')).filter((entry) => entry.length > 0);
}

/**
 * Waits for a manifest entry that was not there when the wait began, so the
 * entry observed afterwards belongs to the run this promote started. A timeout
 * aborts: the promote never assumes a backup it cannot see.
 */
async function awaitFreshBackupEntry(known: ReadonlySet<string>): Promise<string> {
  const deadline = Date.now() + PRE_PROMOTE_BACKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entries = await settle(readManifestEntries());
    if (entries.ok) {
      const fresh = entries.value.find((entry) => !known.has(entry));
      if (fresh !== undefined) return fresh;
    }
    await delay(PRE_PROMOTE_BACKUP_POLL_MS);
  }
  throw new Error(
    `No new backup appeared in ${MANIFEST_FILE} within ${Math.round(PRE_PROMOTE_BACKUP_TIMEOUT_MS / 1000)}s. Nothing was written; check ${MONITOR_CONTAINER} and try again.`,
  );
}

async function runPrePromoteBackup(): Promise<string> {
  const before = await settle(readManifestEntries());
  if (!before.ok) throw new Error(`${MANIFEST_FILE} could not be read, so a fresh backup cannot be told apart from an older one: ${describeFailure(before.error)}`);
  await execFileAsync('docker', ['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT], {
    timeout: DOCKER_TIMEOUT_MS,
    maxBuffer: DOCKER_MAX_OUTPUT_BYTES,
  });
  return awaitFreshBackupEntry(new Set(before.value));
}

// ---------------------------------------------------------------------------
// Staging load
// ---------------------------------------------------------------------------

async function runLiveSql(env: LiveDatabaseEnv, sql: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, LIVE_CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-t', '-A', '-c', sql],
    { timeout: timeoutMs, maxBuffer: DOCKER_MAX_OUTPUT_BYTES },
  );
  return stdout;
}

/**
 * Loads one table's archive rows into its staging table as a single JSON
 * document. The rows leave the scratch container and re-enter the live
 * database through this process, because `pg_restore -L` cannot redirect a
 * restore into another schema.
 */
async function loadStagingTable(container: string, env: LiveDatabaseEnv, staging: string, table: string, columns: readonly string[]): Promise<void> {
  const pkColumns = catalogPrimaryKeys(table);
  const exported = await settle(scratchQuery(container, scratchExportSql(table, columns, pkColumns), DOCKER_TIMEOUT_MS));
  if (!exported.ok) {
    throw new Error(
      `"${table}" could not be read out of the scratch container: ${describeFailure(exported.error)}. The applier serialises one table at a time and cannot exceed ${MAX_TABLE_EXPORT_BYTES} bytes of output, so a table this large must be promoted on its own.`,
    );
  }
  const payload = exported.value.trim();
  if (Buffer.byteLength(payload) > MAX_TABLE_EXPORT_BYTES) {
    throw new Error(`"${table}" serialises to more than the ${MAX_TABLE_EXPORT_BYTES} byte per-table ceiling.`);
  }
  await runLiveSql(env, stagingLoadSql(staging, table, columns).replace('$1::json', `'${payload.replace(/'/g, "''")}'::json`), APPLY_STATEMENT_TIMEOUT_MS);
}

/**
 * Drops any staging schema left by an earlier attempt before rebuilding it, so
 * a retried promote starts from a clean staging area rather than failing on a
 * name that is already taken.
 *
 * `fsobjects` is not staged: its digest list and its bytes are both read from
 * the scratch container, and a content-addressed table can carry one row per
 * stored file, so staging it would spend the export ceiling on rows nothing
 * reads back.
 */
async function loadStaging(
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

// ---------------------------------------------------------------------------
// Per-table transactions
// ---------------------------------------------------------------------------

/**
 * One table, one transaction. The statement timeout is local to it, so a
 * stalled merge rolls that table back and leaves every earlier commit in place.
 * The row count afterwards must equal what the strategy promised, or the
 * transaction is rolled back rather than reported as applied.
 */
async function applyOneTable(
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

async function liveCount(env: LiveDatabaseEnv, sql: string): Promise<number> {
  return countFrom(await runLiveSql(env, sql, DOCKER_TIMEOUT_MS));
}

function tableNote(table: string, strategy: TableStrategy, stagingRows: number, adminColumn: string | null, pkColumns: readonly string[]): { readonly note?: string } {
  const notes: string[] = [];
  if (adminColumn !== null) notes.push(`${adminColumn} set to NULL on ${stagingRows} restored row(s)`);
  if (strategy === 'overwrite') notes.push(`replaced ${stagingRows} live row(s) the archive carries`);
  if (pkColumns.length !== 1) notes.push('composite key, so no sequence was advanced');
  return notes.length === 0 ? {} : { note: notes.join('; ') };
}



/**
 * Large objects are content-addressed, so a merge copies bytes only for digests
 * live has never seen and leaves the rest of the table alone. Each copied blob
 * is written with `lo_from_bytea`, which mints a live oid; the archive's own oid
 * is never reused because it names a large object in the scratch database.
 */
async function applyLargeObjects(
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

// ---------------------------------------------------------------------------
// Promote
// ---------------------------------------------------------------------------

function abortRun(previewId: string, reportId: string, staging: string, errors: readonly string[], warnings: readonly string[] = []): PromoteReport {
  return { ok: false, previewId, reportId, stagingSchema: staging, tableRecords: [], appliedTables: [], pendingTables: [], errors, warnings };
}

/** Everything that must hold before the promote is allowed to touch a live row. */
function preconditionError(
  previewId: string,
  staging: string,
  strategiesValid: boolean,
  unknown: readonly string[],
  order: readonly string[],
  confirmToken: unknown,
  nowMs: number,
): string | null {
  if (!isPreviewId(previewId)) return 'Unknown preview id.';
  if (!strategiesValid) return `Not a catalog table or not a valid strategy: ${unknown.join(', ')}`;
  if (order.length === 0) return 'Every table is skipped, so there is nothing to promote.';
  return checkConfirmToken(staging, confirmToken, nowMs);
}

interface PromoteSetup {
  readonly env: LiveDatabaseEnv;
  readonly facts: ApplyFacts;
  readonly warnings: readonly string[];
}

/**
 * Applies a validated preview to the live database: fresh full backup, staging
 * load, then one committed transaction per table in foreign-key order.
 *
 * `confirmToken` must be the `reportId` of the `validatePromote` run this
 * promote follows, which is the double confirmation: the operator has seen the
 * measured report, and it is refused once older than `PROMOTE_TOKEN_TTL_MS`
 * because the live database moves on underneath a measurement.
 *
 * A table that fails is rolled back and every later table is left pending;
 * tables already committed stay committed. Re-running with the applied tables
 * set to `skip` resumes exactly the pending ones.
 */
export async function promotePreview(previewId: string, strategies: ApplyStrategies, confirmToken: string): Promise<PromoteReport> {
  await ensurePermission('all');
  const staging = isPreviewId(previewId) ? stagingSchemaName(previewId) : 'restore_staging_00000000';
  const reportId = typeof confirmToken === 'string' ? confirmToken : '';
  const { ok, resolved, unknown } = normalizeStrategies(strategies ?? {});
  const order = applyOrder(resolved);
  const refusal = preconditionError(previewId, staging, ok, unknown, order, confirmToken, Date.now());
  if (refusal !== null) return abortRun(previewId, reportId, staging, [refusal]);

  const container = previewContainerName(previewId);
  const alive = await settle(runDocker(['exec', container, 'true']));
  if (!alive.ok) return abortRun(previewId, reportId, staging, [`Scratch container ${container} is gone; nothing was written.`]);
  const setup = await settle(preparePromote(container, resolved, order));
  if (!setup.ok) return abortRun(previewId, reportId, staging, [`Promote refused before writing: ${describeFailure(setup.error)}`]);
  if (setup.value.planErrors.length > 0) return abortRun(previewId, reportId, staging, setup.value.planErrors, setup.value.warnings);

  const gate = await settle(runPrePromoteBackup());
  if (!gate.ok) return abortRun(previewId, reportId, staging, [`Pre-promote backup gate: ${describeFailure(gate.error)}`]);
  const { env, facts, warnings } = setup.value;
  const loaded = await settle(loadStaging(container, env, staging, order, facts));
  if (!loaded.ok) {
    const cleanupError = await dropStaging(staging, env);
    return {
      ...abortRun(previewId, reportId, staging, [`Staging load failed; no live row was written: ${describeFailure(loaded.error)}`]),
      backupEntry: gate.value,
      warnings: cleanupError === null ? [] : [cleanupError],
    };
  }
  const applied = await applyTables(container, env, staging, order, resolved, facts);
  const cleanupError = await dropStaging(staging, env);
  return finish(previewId, reportId, staging, gate.value, applied.records, order, applied.errors, cleanupError === null ? warnings : [...warnings, cleanupError]);
}

/**
 * Re-measures and re-plans immediately before writing, so a promote never acts
 * on a report whose rules passed minutes ago against a database that has since
 * moved.
 */
async function preparePromote(container: string, strategies: ApplyStrategies, order: readonly string[]): Promise<PromoteSetup & { readonly planErrors: readonly string[] }> {
  const facts = await measureFacts(container, strategies, order);
  const plan = planApply(strategies, facts);
  await assertArchiveBlobsIntact(container, strategies);
  return { env: liveDatabaseEnv(), facts, warnings: plan.warnings, planErrors: plan.errors };
}

/** One committed transaction per table, stopping at the first failure. */
async function applyTables(
  container: string,
  env: LiveDatabaseEnv,
  staging: string,
  order: readonly string[],
  strategies: ApplyStrategies,
  facts: ApplyFacts,
): Promise<{ readonly records: readonly TableApplyRecord[]; readonly errors: readonly string[] }> {
  const records: TableApplyRecord[] = [];
  const errors: string[] = [];
  for (const table of order) {
    try {
      records.push(
        table === LARGE_OBJECT_TABLE
          ? await applyLargeObjects(container, env, strategies[table])
          : await applyOneTable(env, staging, table, strategies[table], strategies, facts),
      );
    } catch (error) {
      records.push({ table, strategy: strategies[table], status: 'failed', liveBefore: 0, liveAfter: 0, merged: 0, note: describeFailure(error) });
      errors.push(`"${table}" failed and every later table was left pending: ${describeFailure(error)}`);
      break;
    }
  }
  return { records, errors };
}

/**
 * The staging schema is dropped whatever happened. A failure here is reported
 * alongside the run rather than swallowed: leftover staging rows are harmless
 * but they are disk the operator should know is still there.
 */
async function dropStaging(staging: string, env: LiveDatabaseEnv): Promise<string | null> {
  const dropped = await settle(runLiveSql(env, dropStagingSchemaSql(staging), DOCKER_TIMEOUT_MS));
  return dropped.ok ? null : `Staging schema ${staging} could not be dropped: ${describeFailure(dropped.error)}`;
}

/**
 * Reports exactly what applied and what is still pending, so a resumed run can
 * skip the committed tables. The staging schema is dropped here whatever
 * happened, and the summary goes to Discord whether or not the run succeeded.
 */
async function finish(
  previewId: string,
  reportId: string,
  staging: string,
  backupEntry: string | undefined,
  records: readonly TableApplyRecord[],
  order: readonly string[],
  errors: readonly string[],
  warnings: readonly string[],
): Promise<PromoteReport> {
  const appliedTables = records.filter((record) => record.status === 'applied').map((record) => record.table);
  const pendingTables = order.filter((table) => !appliedTables.includes(table));
  await logToDiscord(
    errors.length === 0 ? 'Restore Merge Applied' : 'Restore Merge Stopped',
    `Preview \`${previewId}\`: ${appliedTables.length}/${records.length || order.length} table(s) applied${errors.length > 0 ? `, stopped on \`${errors[0]}\`` : ''}. Backup: ${backupEntry ?? 'none'}. Re-run with the applied tables skipped to resume.`,
    PROMOTE_CONSOLE_COLOR,
  );
  return { ok: errors.length === 0 && pendingTables.length === 0, previewId, reportId, stagingSchema: staging, backupEntry, tableRecords: records, appliedTables, pendingTables, errors, warnings };
}