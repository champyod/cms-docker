'use server';

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getBackupRoot } from '@/lib/backup-archives';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { isPreviewId, previewContainerName } from '@/lib/restore-preview-store';
import { LARGE_OBJECT_TABLE, applyOrder, buildReportId, checkConfirmToken, normalizeStrategies, planApply, stagingSchemaName } from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, PromoteReport, TableApplyRecord, ValidateReport } from '@/lib/restore-apply';
import { DOCKER_MAX_OUTPUT_BYTES, DOCKER_TIMEOUT_MS, measureFacts, preparePromote } from './restore-apply-measure';
import type { LiveDatabaseEnv } from './restore-apply-measure';
import { applyLargeObjects, applyOneTable, dropStaging, loadStaging } from './restore-apply-steps';
import { describeFailure, runDocker, settle } from './restore-preview-run';

export { APPLY_STATEMENT_TIMEOUT_MS, MAX_RELAY_CHUNK_BYTES } from './restore-apply-steps';

const execFileAsync = promisify(execFile);

const MANIFEST_FILE = 'manifest.json';
const MONITOR_CONTAINER = 'cms-monitor';
const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';
const PROMOTE_CONSOLE_COLOR = 16711680;

/**
 * The gate that makes a promote recoverable: one full backup must land in the
 * manifest before any live row is written. Bounded on purpose, and a timeout
 * aborts rather than proceeding on an assumption about the run.
 */
export const PRE_PROMOTE_BACKUP_TIMEOUT_MS = 900_000;
export const PRE_PROMOTE_BACKUP_POLL_MS = 10_000;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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