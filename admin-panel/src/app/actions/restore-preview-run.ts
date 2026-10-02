/**
 * Preview lifecycle and measurement helpers: the docker scratch container, the
 * quarantined dump lookup, and the read-only archive-versus-live measurements
 * the preview server actions compose into results.
 *
 * Every effect the preview owns lives here or in the caller: this module owns
 * running docker and querying the scratch container and the live database, and
 * nothing here decides what a failure means for the preview as a whole.
 */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { MAX_PK_SAMPLE_ROWS, previewContainerName, previewQuarantineDir, scratchDatabaseEnv } from '@/lib/restore-preview-store';
import { parseRestoreList, pkSampleExpression, qualifiedTable, summarizeToc } from '@/lib/restore-preview';
import type { PkOverlapSample, TocSummary } from '@/lib/restore-preview';

const execFileAsync = promisify(execFile);

/** CMS dumps are written by the default Prisma schema; any other schema fails the query loudly instead of reading nothing. */
export const ARCHIVE_SCHEMA = 'public';
export const CONTAINER_DUMP_PATH = '/tmp/preview.dump';
export const RESTORE_TIMEOUT_MS = 900_000;
const POSTGRES_READY_ATTEMPTS = 30;
const POSTGRES_READY_INTERVAL_MS = 1_000;
const DOCKER_TIMEOUT_MS = 30_000;
const DOCKER_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Restore preview failed.';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return stderr.length > 0 ? `${error.message}: ${stderr}` : error.message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDocker(args: string[], timeoutMs: number = DOCKER_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, { timeout: timeoutMs, maxBuffer: DOCKER_MAX_OUTPUT_BYTES });
  return stdout;
}

export async function scratchQuery(container: string, sql: string, timeoutMs: number = DOCKER_TIMEOUT_MS): Promise<string> {
  const env = scratchDatabaseEnv();
  return runDocker(
    ['exec', container, 'psql', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-t', '-A', '-c', sql],
    timeoutMs,
  );
}

/** Readiness is a real psql round trip, not pg_isready: the image runs a temporary server during initdb. */
export async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 1; attempt <= POSTGRES_READY_ATTEMPTS; attempt += 1) {
    const ready = await scratchQuery(container, 'SELECT 1').then(
      () => true,
      () => false,
    );
    if (ready) return;
    await delay(POSTGRES_READY_INTERVAL_MS);
  }
  throw new Error(`Scratch postgres ${container} was not reachable after ${POSTGRES_READY_ATTEMPTS} attempts.`);
}

export async function parseJsonRows(stdout: string): Promise<unknown[]> {
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  if (!Array.isArray(parsed)) throw new Error('Scratch query did not return a JSON array.');
  return parsed;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a row count, got: ${String(value)}`);
  return parsed;
}

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** One failed measurement is reported beside the diff instead of aborting the whole preview. */
export async function settle<T>(measurement: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await measurement };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
}

export async function countArchiveRows(container: string, table: string): Promise<number> {
  const sql = `SELECT count(*)::bigint::text FROM ${qualifiedTable(ARCHIVE_SCHEMA, table)}`;
  return toCount((await scratchQuery(container, sql)).trim());
}

export async function countLiveRows(table: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: string }[]>(
    Prisma.sql`SELECT count(*)::bigint::text AS "count" FROM ${Prisma.raw(qualifiedTable(ARCHIVE_SCHEMA, table))}`,
  );
  return toCount(rows[0]?.count);
}

/**
 * Projects a primary-key sample of the archive onto the live table. Every
 * interpolated fragment is a catalog identifier or a validated expression; the
 * sampled keys themselves are bound parameters.
 */
export async function measureOverlap(container: string, pks: readonly string[], table: string): Promise<PkOverlapSample | null> {
  const expression = pkSampleExpression(pks);
  const keySql = `SELECT (${expression})::text FROM ${qualifiedTable(ARCHIVE_SCHEMA, table)} LIMIT ${MAX_PK_SAMPLE_ROWS}`;
  const keys = (await scratchQuery(container, keySql))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (keys.length === 0) return null;
  const overlapRows = await prisma.$queryRaw<{ count: string }[]>(Prisma.sql`
    SELECT count(*)::bigint::text AS "count"
    FROM ${Prisma.raw(qualifiedTable(ARCHIVE_SCHEMA, table))}
    WHERE (${Prisma.raw(`(${expression})::text`)}) IN (${Prisma.join(keys)})
  `);
  return { overlap: toCount(overlapRows[0]?.count), sampleSize: keys.length };
}

export async function readToc(container: string): Promise<TocSummary> {
  const tocText = await runDocker(['exec', container, 'pg_restore', '--list', CONTAINER_DUMP_PATH]);
  return summarizeToc(parseRestoreList(tocText));
}

export async function resolveDumpFile(previewId: string): Promise<string | null> {
  const dir = previewQuarantineDir(previewId);
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.endsWith('.dump')) continue;
    const candidate = path.join(dir, entry);
    if (path.relative(dir, candidate).startsWith('..')) continue;
    return candidate;
  }
  return null;
}

export async function teardownPreview(previewId: string): Promise<void> {
  try {
    await runDocker(['rm', '-f', previewContainerName(previewId)]);
  } catch (error) {
    if (!describeFailure(error).includes('No such container')) throw error;
  }
}