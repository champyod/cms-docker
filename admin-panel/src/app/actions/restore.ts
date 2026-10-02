'use server';

import { rm } from 'node:fs/promises';
import path from 'node:path';

import { BACKUP_TABLE_NAMES, BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';
import { ensurePermission } from '@/lib/permissions';
import { MAX_SAMPLE_ROWS, buildTableDiff, clampSampleRowCount, qualifiedTable, quoteIdentifier, shapeSampleRows } from '@/lib/restore-preview';
import type { JsonValue, PkOverlapSample, TableDiffRow, TocSummary } from '@/lib/restore-preview';
import {
  SCRATCH_IMAGE,
  isPreviewId,
  previewContainerName,
  previewQuarantineDir,
  scratchDatabaseEnv,
} from '@/lib/restore-preview-store';
import {
  ARCHIVE_SCHEMA,
  CONTAINER_DUMP_PATH,
  RESTORE_TIMEOUT_MS,
  countArchiveRows,
  countLiveRows,
  describeFailure,
  measureOverlap,
  parseJsonRows,
  readToc,
  resolveDumpFile,
  runDocker,
  scratchQuery,
  settle,
  teardownPreview,
  waitForPostgres,
} from './restore-preview-run';

const PREVIEW_LABEL = 'cms.restore-preview';

export interface PreviewStartResult {
  readonly success: boolean;
  readonly started: boolean;
  readonly message?: string;
  readonly error?: string;
  /** Catalog warnings for the tables this archive carries, including the admins-remap warning. */
  readonly warnings: readonly string[];
}

export interface PreviewTablesResult {
  readonly success: boolean;
  readonly previewId: string;
  readonly tables: readonly TableDiffRow[];
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly error?: string;
}

export interface PreviewSampleResult {
  readonly success: boolean;
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: readonly JsonValue[];
  readonly error?: string;
}

export interface PreviewDeletionResult {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: string;
}

function previewWarnings(toc: TocSummary | null): readonly string[] {
  if (toc === null) return [];
  const catalog = validateTableSelection([...toc.catalogTables]).warnings;
  const unknown =
    toc.unknownTables.length > 0
      ? [`The archive also holds ${toc.unknownTables.length} table(s) outside the backup catalog, which preview ignores: ${toc.unknownTables.join(', ')}.`]
      : [];
  return [...catalog, ...unknown];
}

/**
 * Restores an uploaded dump into a throwaway postgres:15 container and leaves it
 * running for the diff and sample reads. The live database is never a restore
 * target here; only the read-only counts in getPreviewTables touch it.
 *
 * A failed start removes the container but keeps the quarantined dump so the
 * upload can be retried, and deletePreview removes the rest. A preview nobody
 * deletes leaves its container behind, findable by name or label prefix
 * `cms-restore-preview-` for an operator sweep.
 */
export async function startPreview(previewId: string): Promise<PreviewStartResult> {
  await ensurePermission('all');
  if (!isPreviewId(previewId)) return { success: false, started: false, error: 'Unknown preview id.', warnings: [] };
  const dump = await resolveDumpFile(previewId);
  if (dump === null) {
    return { success: false, started: false, error: `No quarantined dump for preview ${previewId}.`, warnings: [] };
  }
  const container = previewContainerName(previewId);
  const env = scratchDatabaseEnv();
  let toc: TocSummary | null = null;
  try {
    await runDocker([
      'run', '--name', container, '--label', `${PREVIEW_LABEL}=${previewId}`,
      '-e', `POSTGRES_USER=${env.POSTGRES_USER}`,
      '-e', `POSTGRES_PASSWORD=${env.POSTGRES_PASSWORD}`,
      '-e', `POSTGRES_DB=${env.POSTGRES_DB}`,
      '-d', SCRATCH_IMAGE,
    ]);
    await waitForPostgres(container);
    await runDocker(['cp', dump, `${container}:${CONTAINER_DUMP_PATH}`]);
    toc = await readToc(container);
    if (toc.catalogTables.length === 0) throw new Error('The archive holds none of the backup catalog tables.');
    await runDocker([
      'exec', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, container,
      'pg_restore', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-Fc',
      // Ownership and privileges are irrelevant in a throwaway container and would
      // fail on roles the dump names; --exit-on-error makes a non-zero exit mean a
      // real restore failure instead of ignorable warnings.
      '--no-owner', '--no-privileges', '--exit-on-error', CONTAINER_DUMP_PATH,
    ], RESTORE_TIMEOUT_MS);
  } catch (error) {
    const cleanup = await teardownPreview(previewId).then(
      () => '',
      (cleanupError) => ` Scratch cleanup also failed: ${describeFailure(cleanupError)}`,
    );
    return { success: false, started: false, error: `${describeFailure(error)}${cleanup}`, warnings: previewWarnings(toc) };
  }
  return {
    success: true,
    started: true,
    message: `Restored ${path.basename(dump)} into scratch container ${container}; live data is untouched.`,
    warnings: previewWarnings(toc),
  };
}

/**
 * Per-table archive and live row counts, an added-row estimate from the counts,
 * and an updated-row estimate projected from an archive primary-key sample.
 *
 * Every catalog table gets a row, so a table the archive does not carry shows up
 * as absent instead of disappearing. Each measurement is reported on its own
 * when it fails rather than failing the whole preview, and the archive side of a
 * table is only measured when the TOC says the archive has it.
 */
export async function getPreviewTables(previewId: string): Promise<PreviewTablesResult> {
  await ensurePermission('all');
  const unknown: PreviewTablesResult = { success: false, previewId, tables: [], failures: [], warnings: [], error: 'Unknown preview id.' };
  if (!isPreviewId(previewId)) return unknown;
  const container = previewContainerName(previewId);
  const archiveCounts = new Map<string, number>();
  const liveCounts = new Map<string, number>();
  const overlapSamples = new Map<string, PkOverlapSample>();
  const failures: string[] = [];
  try {
    const toc = await readToc(container);
    for (const catalogTable of BACKUP_TABLES) {
      const live = await settle(countLiveRows(catalogTable.name));
      if (live.ok) liveCounts.set(catalogTable.name, live.value);
      else failures.push(`${catalogTable.name}: live count failed — ${live.error}`);
    }
    for (const name of toc.catalogTables) {
      const catalogTable = BACKUP_TABLES.find((table) => table.name === name);
      if (catalogTable === undefined) continue;
      const [archive, sample] = await Promise.all([
        settle(countArchiveRows(container, name)),
        settle(measureOverlap(container, catalogTable.pk, name)),
      ]);
      if (archive.ok) archiveCounts.set(name, archive.value);
      else failures.push(`${name}: archive count failed — ${archive.error}`);
      if (sample.ok && sample.value !== null) overlapSamples.set(name, sample.value);
      else {
        failures.push(`${name}: primary-key overlap failed — ${sample.ok ? 'the archive table has no rows to sample' : sample.error}`);
      }
    }
    return {
      success: true,
      previewId,
      tables: buildTableDiff(BACKUP_TABLE_NAMES, archiveCounts, liveCounts, overlapSamples),
      failures,
      warnings: previewWarnings(toc),
    };
  } catch (error) {
    return { ...unknown, error: describeFailure(error) };
  }
}

/** Reads at most MAX_SAMPLE_ROWS archive rows for one catalog table out of the scratch container. */
export async function getSampleRows(
  previewId: string,
  table: string,
  count: number = MAX_SAMPLE_ROWS,
): Promise<PreviewSampleResult> {
  await ensurePermission('all');
  const missing: PreviewSampleResult = { success: false, table, columns: [], rows: [], error: 'Unknown preview id.' };
  if (!isPreviewId(previewId)) return missing;
  const catalogTable = BACKUP_TABLES.find((entry) => entry.name === table);
  if (catalogTable === undefined) return { ...missing, error: `${table} is not in the backup table catalog.` };
  const container = previewContainerName(previewId);
  const limit = clampSampleRowCount(count);
  try {
    const columnSql = `SELECT column_name FROM information_schema.columns WHERE table_schema = '${ARCHIVE_SCHEMA}' AND table_name = '${catalogTable.name}' ORDER BY ordinal_position`;
    const columns = (await scratchQuery(container, columnSql))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (columns.length === 0) throw new Error(`The archive has no table ${ARCHIVE_SCHEMA}.${catalogTable.name}.`);
    const selected = columns.map(quoteIdentifier).join(', ');
    const rowsSql = `SELECT coalesce(json_agg(v), '[]'::json) FROM (SELECT json_build_array(${selected}) AS v FROM ${qualifiedTable(ARCHIVE_SCHEMA, catalogTable.name)} LIMIT ${limit}) s`;
    const shaped = shapeSampleRows(columns, await parseJsonRows(await scratchQuery(container, rowsSql)), limit);
    return { success: true, table, columns: shaped.columns, rows: shaped.rows };
  } catch (error) {
    return { success: false, table, columns: [], rows: [], error: describeFailure(error) };
  }
}

/** Removes the scratch container and the quarantined dump. Best effort in the sense that an already-gone container or directory is success. */
export async function deletePreview(previewId: string): Promise<PreviewDeletionResult> {
  await ensurePermission('all');
  if (!isPreviewId(previewId)) return { success: false, error: 'Unknown preview id.' };
  try {
    await teardownPreview(previewId);
    await rm(previewQuarantineDir(previewId), { recursive: true, force: true });
    return { success: true, message: `Removed preview ${previewId}, its scratch container and its quarantined dump.` };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}