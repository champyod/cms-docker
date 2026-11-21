'use server';

/**
 * Resolving one blocking conflict, on the preview's scratch copy only.
 *
 * A resolution never touches the live database. It rewrites the archive rows the
 * preview holds in the scratch container, and the operator then validates again:
 * the re-measurement compares the rewritten archive against live and the conflict
 * is gone, so the promote that follows needs no special case and no new contract.
 *
 * Skipping a table is not here. It is one strategy change in the record the
 * client already sends, so it needs no server write at all.
 *
 * Why every export carries `backup:restore` itself: this directory is scanned as
 * a set of entry points, so the action is read as one that can be called on its
 * own. The preview actions gate the same key, so the repeat check costs one
 * cached session read and never widens or narrows what a caller may already do.
 */

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { ensurePermission } from '@/lib/permissions';
import { isPreviewId, previewContainerName, scratchDatabaseEnv } from '@/lib/restore-preview-store';
import {
  catalogPrimaryKeys,
  fkEdgesSql,
  parseFkEdges,
  planKeyRenameCascade,
  scratchDeleteRowSql,
  scratchRewriteBatchSql,
  scratchUpdateKeySql,
  scratchUpdateValueSql,
} from '@/lib/restore-apply';
import type { FkEdge, FkEdgeRow, KeyRenameStep, ScratchRewrite } from '@/lib/restore-apply';
import { describeFailure, runDocker, settle } from './restore-preview-run';

/** How long one resolution's rewrite batch may take before it is abandoned. */
const RESOLVE_TIMEOUT_MS = 120_000;

/** What the operator chose for one conflict. */
export type ConflictResolution =
  | { readonly action: 'keep-live' }
  | { readonly action: 'take-archive'; readonly toValues: readonly string[] }
  | { readonly action: 'autogenerate'; readonly column: string; readonly value: string };

export interface ResolveConflictInput {
  readonly previewId: string;
  /** The table the conflicting archive row lives in. */
  readonly table: string;
  /**
   * The archive row's key values, in the table's catalog primary-key order. The
   * columns are not sent: the server reads them from the catalog, so a caller
   * cannot aim a rewrite at a column set the table is not keyed by.
   */
  readonly keyValues: readonly string[];
  readonly resolution: ConflictResolution;
}

export interface ResolveConflictResult {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: string;
}

/** The reason a request is refused before anything is written, or null. */
function refusalOf(input: ResolveConflictInput): string | null {
  if (!isPreviewId(input.previewId)) return 'Unknown preview id.';
  if (!BACKUP_TABLE_NAMES.includes(input.table)) return `${input.table} is not in the backup table catalog.`;
  const catalogKey = catalogPrimaryKeys(input.table);
  if (catalogKey.length === 0) return `${input.table} has no catalog primary key, so its rows cannot be identified.`;
  if (input.keyValues.length !== catalogKey.length) {
    return `${input.table} is identified by ${catalogKey.join(', ')}, so its key needs ${catalogKey.length} value(s) and ${input.keyValues.length} arrived.`;
  }
  if (input.resolution.action === 'take-archive' && input.resolution.toValues.length !== catalogKey.length) return 'The live row key is incomplete.';
  if (input.resolution.action === 'autogenerate' && input.resolution.value.length === 0) return 'A generated value is required.';
  return null;
}

/** The scratch copy's own foreign keys, so a rename can reach the rows that point at it. */
async function scratchFkEdges(container: string): Promise<readonly FkEdge[]> {
  const raw = await runDocker(['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', scratchDatabaseEnv().POSTGRES_USER, '-d', scratchDatabaseEnv().POSTGRES_DB, '-t', '-A', '-F', '\t', '-c', fkEdgesSql()], RESOLVE_TIMEOUT_MS);
  const rows: FkEdgeRow[] = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(toEdgeRow);
  return parseFkEdges(rows);
}

function toEdgeRow(line: string): FkEdgeRow {
  const [constraint, childTable, childColumn, parentTable, parentColumn] = line.split('\t');
  return {
    constraint: constraint ?? '',
    childTable: childTable ?? '',
    childColumn: childColumn ?? '',
    parentTable: parentTable ?? '',
    parentColumn: parentColumn ?? '',
  };
}

/**
 * Rewrites the archive rows a rename has to reach.
 *
 * Every catalog table is followed rather than only the applied ones: the rewrite
 * lives in the scratch copy, where a skipped table's rows are never merged and so
 * cost nothing, and following all of them cannot miss a chain that passes through
 * a table this promote happens to skip.
 */
async function takeArchiveRewrites(container: string, input: ResolveConflictInput, toValues: readonly string[]): Promise<readonly ScratchRewrite[]> {
  const edges = await scratchFkEdges(container);
  const start: KeyRenameStep = { table: input.table, columns: catalogPrimaryKeys(input.table), fromValues: input.keyValues, toValues };
  return planKeyRenameCascade(edges, [...BACKUP_TABLE_NAMES], start).map((step) => ({
    table: step.table,
    sql: scratchUpdateKeySql(step.table, step.columns, step.fromValues, step.toValues),
  }));
}

function rewritesFor(container: string, input: ResolveConflictInput): Promise<readonly ScratchRewrite[]> {
  const { resolution } = input;
  const keyColumns = catalogPrimaryKeys(input.table);
  if (resolution.action === 'keep-live') {
    return Promise.resolve([{ table: input.table, sql: scratchDeleteRowSql(input.table, keyColumns, input.keyValues) }]);
  }
  if (resolution.action === 'take-archive') return takeArchiveRewrites(container, input, resolution.toValues);
  return Promise.resolve([
    { table: input.table, sql: scratchUpdateValueSql(input.table, keyColumns, input.keyValues, resolution.column, resolution.value) },
  ]);
}

/**
 * Applies one resolution to the scratch copy and reports whether it landed. The
 * batch runs with `ON_ERROR_STOP`, so a refused statement fails the action
 * instead of leaving half a rewrite behind as a success.
 */
export async function resolvePreviewConflict(input: ResolveConflictInput): Promise<ResolveConflictResult> {
  await ensurePermission('backup:restore');
  const refusal = refusalOf(input);
  if (refusal !== null) return { success: false, error: refusal };
  const container = previewContainerName(input.previewId);
  const alive = await settle(runDocker(['exec', container, 'true']));
  if (!alive.ok) return { success: false, error: `Scratch container ${container} is gone, so the archive rows it holds cannot be rewritten.` };
  try {
    const rewrites = await rewritesFor(container, input);
    const env = scratchDatabaseEnv();
    await runDocker(['exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-t', '-A', '-c', scratchRewriteBatchSql(rewrites)], RESOLVE_TIMEOUT_MS);
    return { success: true, message: `Resolved ${describeResolution(input)} on the scratch copy. Validate again to see the updated report.` };
  } catch (error) {
    return { success: false, error: `The resolution could not be applied: ${describeFailure(error)}` };
  }
}

function describeResolution(input: ResolveConflictInput): string {
  if (input.resolution.action === 'keep-live') return `${input.table} row ${input.keyValues.join(', ')} (the archive row was dropped)`;
  if (input.resolution.action === 'take-archive') return `${input.table} row ${input.keyValues.join(', ')} (the archive row now takes the live key)`;
  return `${input.table} row ${input.keyValues.join(', ')} (its ${input.resolution.column} was regenerated)`;
}
