/**
 * Restore-apply measurement: the live and scratch access every apply phase
 * shares, and the read-only archive-versus-live measurements the validate phase
 * and the pre-promote re-measurement are decided from.
 *
 * Every query here either reads or runs a statement on behalf of a caller: the
 * server action owns when a measurement is taken, and the plan module owns what
 * the result means. Nothing here writes a live row.
 *
 * Why every export below carries `backup:restore` itself: this directory is
 * scanned as a set of entry points, so a helper the apply server actions
 * compose is read as one that can be called on its own. The callers gate the
 * same key, so the repeat check costs one cached session read and never widens
 * or narrows what a caller may already do.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Prisma } from '@prisma/client';

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { ensurePermission } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scratchDatabaseEnv } from '@/lib/restore-preview-store';
import {
  LARGE_OBJECT_TABLE,
  archiveDigestBytesForSql,
  archiveDigestBytesSql,
  archiveDigestIntegritySql,
  archiveDigestListSql,
  countRowsSql,
  databaseSizeQuerySql,
  liveColumnsQuerySql,
  liveDigestListQuerySql,
  liveDigestQuerySql,
  liveFkParentQuerySql,
  livePrimaryKeyQuerySql,
  planApply,
} from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies } from '@/lib/restore-apply';
import { readToc, scratchQuery } from './restore-preview-run';

const execFileAsync = promisify(execFile);

export const DOCKER_TIMEOUT_MS = 60_000;
export const DOCKER_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const LIVE_CONTAINER = 'cms-database';

export interface LiveDatabaseEnv {
  readonly POSTGRES_USER: string;
  readonly POSTGRES_PASSWORD: string;
  readonly POSTGRES_DB: string;
}

export function liveDatabaseEnv(): LiveDatabaseEnv {
  const scratch = scratchDatabaseEnv();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  if (password === undefined || password.length === 0) {
    throw new Error('POSTGRES_PASSWORD is not set, so the promote cannot write to the live database.');
  }
  return { POSTGRES_USER: scratch.POSTGRES_USER, POSTGRES_PASSWORD: password, POSTGRES_DB: scratch.POSTGRES_DB };
}

export function lines(stdout: string): string[] {
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

export async function countFrom(value: string): Promise<number> {
  await ensurePermission('backup:restore');
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

export async function liveDigestSet(): Promise<Set<string>> {
  await ensurePermission('backup:restore');
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

export async function measureFacts(container: string, strategies: ApplyStrategies, order: readonly string[]): Promise<ApplyFacts> {
  await ensurePermission('backup:restore');
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
export async function assertArchiveBlobsIntact(container: string, strategies: ApplyStrategies): Promise<void> {
  await ensurePermission('backup:restore');
  if (strategies[LARGE_OBJECT_TABLE] === 'skip') return;
  const dangling = await countFrom(await scratchQuery(container, archiveDigestIntegritySql()));
  if (dangling > 0) {
    throw new Error(
      `The archive's ${LARGE_OBJECT_TABLE} has ${dangling} row(s) whose large object is missing from the scratch container, so their bytes cannot be copied. Promote without ${LARGE_OBJECT_TABLE} or re-upload the archive.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Live statement access
// ---------------------------------------------------------------------------

export async function runLiveSql(env: LiveDatabaseEnv, sql: string, timeoutMs: number): Promise<string> {
  await ensurePermission('backup:restore');
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, LIVE_CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-t', '-A', '-c', sql],
    { timeout: timeoutMs, maxBuffer: DOCKER_MAX_OUTPUT_BYTES },
  );
  return stdout;
}

export async function liveCount(env: LiveDatabaseEnv, sql: string): Promise<number> {
  await ensurePermission('backup:restore');
  return countFrom(await runLiveSql(env, sql, DOCKER_TIMEOUT_MS));
}

export interface PromoteSetup {
  readonly env: LiveDatabaseEnv;
  readonly facts: ApplyFacts;
  readonly warnings: readonly string[];
}

/**
 * Re-measures and re-plans immediately before writing, so a promote never acts
 * on a report whose rules passed minutes ago against a database that has since
 * moved.
 */
export async function preparePromote(container: string, strategies: ApplyStrategies, order: readonly string[]): Promise<PromoteSetup & { readonly planErrors: readonly string[] }> {
  await ensurePermission('backup:restore');
  const facts = await measureFacts(container, strategies, order);
  const plan = planApply(strategies, facts);
  await assertArchiveBlobsIntact(container, strategies);
  return { env: liveDatabaseEnv(), facts, warnings: plan.warnings, planErrors: plan.errors };
}