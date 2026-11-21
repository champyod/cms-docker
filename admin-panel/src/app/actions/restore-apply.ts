'use server';

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getBackupRoot } from '@/lib/backup-archives';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { isPreviewId, previewContainerName } from '@/lib/restore-preview-store';
import { LARGE_OBJECT_TABLE, applyOrder, buildReportId, checkConfirmToken, normalizeStrategies, parseReportId, planApply, stagingSchemaName } from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, PromoteReport, TableApplyRecord, ValidateReport } from '@/lib/restore-apply';
import { WAITING_PROGRESS, readPromoteStatus, startPromoteProgress, sweepStaleProgress } from '@/lib/restore-apply-progress';
import type { PromoteProgressWriter, PromoteStatus } from '@/lib/restore-apply-progress';
import { DOCKER_MAX_OUTPUT_BYTES, DOCKER_TIMEOUT_MS, measureFacts, preparePromote } from './restore-apply-measure';
import type { LiveDatabaseEnv } from './restore-apply-measure';
import { acquireStagingLock } from './restore-apply-lock';
import { applyLargeObjects, applyOneTable, dropStaging, loadStaging } from './restore-apply-steps';
import { describeFailure, runDocker, settle } from './restore-preview-run';

const execFileAsync = promisify(execFile);

const MANIFEST_FILE = 'manifest.json';
/** The only kind that opens the pre-promote gate: a selective run carries a subset of the tables. */
const MANIFEST_FULL_KIND = 'full';
const MONITOR_CONTAINER = 'cms-monitor';
const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';
const PROMOTE_CONSOLE_COLOR = 16711680;

/**
 * The gate that makes a promote recoverable: one full backup must land in the
 * manifest before any live row is written, and a timeout aborts.
 */
const PRE_PROMOTE_BACKUP_TIMEOUT_MS = 900_000;
const PRE_PROMOTE_BACKUP_POLL_MS = 10_000;

/** Read-only phase: the report whose `reportId` the operator must confirm with before `promotePreview` writes anything. */
export async function validatePromote(previewId: string, strategies: ApplyStrategies): Promise<ValidateReport> {
  await ensurePermission('backup:restore');
  await sweepStaleProgress();
  const generatedAtMs = Date.now();
  const staging = isPreviewId(previewId) ? stagingSchemaName(previewId) : 'restore_staging_00000000';
  const reportId = buildReportId(staging, generatedAtMs);
  const fail = (errors: readonly string[]): ValidateReport => ({ ok: false, reportId, generatedAt: new Date(generatedAtMs).toISOString(), previewId, stagingSchema: staging, tableReports: [], errors, warnings: [], conflicts: [] });
  if (!isPreviewId(previewId)) return fail(['Unknown preview id.']);
  const { ok, resolved, unknown } = normalizeStrategies(strategies ?? {});
  if (!ok) return fail([`Not a catalog table or not a valid strategy: ${unknown.join(', ')}`]);
  const order = applyOrder(resolved);
  if (order.length === 0) return fail(['Every table is skipped, so there is nothing to promote.']);
  const container = previewContainerName(previewId);
  const alive = await settle(runDocker(['exec', container, 'true']));
  if (!alive.ok) return fail([`Scratch container ${container} is gone, so the archive rows it holds cannot be read. Start the preview again.`]);
  try {
    const facts = await measureFacts(container, resolved, order);
    const plan = planApply(resolved, facts);
    return { ok: plan.errors.length === 0, reportId, generatedAt: new Date(generatedAtMs).toISOString(), previewId, stagingSchema: staging, tableReports: plan.tableReports, errors: plan.errors, warnings: plan.warnings, conflicts: plan.conflicts };
  } catch (error) {
    return fail([`Validation could not measure the live database: ${describeFailure(error)}`]);
  }
}

// ---------------------------------------------------------------------------
// Pre-promote backup gate
// ---------------------------------------------------------------------------

interface ManifestEntry { readonly ts?: unknown; readonly kind?: unknown }

async function readManifestEntries(): Promise<readonly string[]> {
  const text = await readFile(path.join(getBackupRoot(), MANIFEST_FILE), 'utf8');
  const parsed: unknown = JSON.parse(text);
  const list: readonly ManifestEntry[] = Array.isArray(parsed) ? parsed : [parsed as ManifestEntry];
  return list.map((entry) => (typeof entry.ts === 'string' ? `${entry.kind ?? MANIFEST_FULL_KIND}:${entry.ts}` : '')).filter((entry) => entry.length > 0);
}

/**
 * Waits for a manifest entry that was not there when the wait began, so the entry
 * observed afterwards belongs to the run this promote started, and only a full
 * backup opens the gate: a selective run inside the window carries a subset of
 * the tables rather than the net this promote needs. An entry written before
 * kinds existed carries none and counts as full.
 */
async function awaitFreshBackupEntry(known: ReadonlySet<string>): Promise<string> {
  const deadline = Date.now() + PRE_PROMOTE_BACKUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entries = await settle(readManifestEntries());
    if (entries.ok) {
      const fresh = entries.value.find((entry) => !known.has(entry) && entry.startsWith(`${MANIFEST_FULL_KIND}:`));
      if (fresh !== undefined) return fresh;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, PRE_PROMOTE_BACKUP_POLL_MS));
  }
  throw new Error(`No new full backup appeared in ${MANIFEST_FILE} within ${Math.round(PRE_PROMOTE_BACKUP_TIMEOUT_MS / 1000)}s. Nothing was written; check ${MONITOR_CONTAINER} and try again.`);
}

async function runPrePromoteBackup(): Promise<string> {
  const before = await settle(readManifestEntries());
  if (!before.ok) throw new Error(`${MANIFEST_FILE} could not be read, so a fresh backup cannot be told apart from an older one: ${before.error}`);
  await execFileAsync('docker', ['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT], { timeout: DOCKER_TIMEOUT_MS, maxBuffer: DOCKER_MAX_OUTPUT_BYTES });
  return awaitFreshBackupEntry(new Set(before.value));
}

// ---------------------------------------------------------------------------
// Promote
// ---------------------------------------------------------------------------

interface PromoteIdentity {
  readonly previewId: string;
  readonly reportId: string;
  readonly staging: string;
}

interface PromoteRun extends PromoteIdentity {
  readonly container: string;
  readonly env: LiveDatabaseEnv;
  readonly order: readonly string[];
  readonly strategies: ApplyStrategies;
  readonly facts: ApplyFacts;
  readonly warnings: readonly string[];
}

interface ApplyOutcome {
  readonly records: readonly TableApplyRecord[];
  readonly errors: readonly string[];
}

/** Publishes a promote's report and hands it back, so no exit ends unreported. */
async function deliver(report: PromoteReport): Promise<PromoteReport> {
  const backup = ` Backup: ${report.backupEntry ?? 'none'}.`;
  const body = report.tableRecords.length === 0
    ? `Preview \`${report.previewId}\` aborted before any table was applied: ${report.errors[0] ?? 'no reason recorded'}.${backup} No live row was written.`
    : `Preview \`${report.previewId}\`: ${report.appliedTables.length}/${report.tableRecords.length} table(s) applied${report.errors.length > 0 ? `, stopped on \`${report.errors[0]}\`` : ''}.${backup} Re-run with the applied tables skipped to resume.`;
  await logToDiscord(report.ok ? 'Restore Merge Applied' : 'Restore Merge Stopped', body, PROMOTE_CONSOLE_COLOR);
  return report;
}

/** Every abort: a refusal, a gone container, a stale re-plan, a closed gate or a failed staging load. */
async function abortPromote(identity: PromoteIdentity, errors: readonly string[], tail: { readonly backupEntry?: string; readonly warnings?: readonly string[] } = {}): Promise<PromoteReport> {
  return deliver({ ok: false, previewId: identity.previewId, reportId: identity.reportId, stagingSchema: identity.staging, backupEntry: tail.backupEntry, tableRecords: [], appliedTables: [], pendingTables: [], errors, warnings: tail.warnings ?? [] });
}

/** Everything that must hold before the promote is allowed to touch a live row. */
function preconditionError(identity: PromoteIdentity, strategiesValid: boolean, unknown: readonly string[], order: readonly string[], confirmToken: unknown, nowMs: number): string | null {
  if (!isPreviewId(identity.previewId)) return 'Unknown preview id.';
  if (!strategiesValid) return `Not a catalog table or not a valid strategy: ${unknown.join(', ')}`;
  if (order.length === 0) return 'Every table is skipped, so there is nothing to promote.';
  return checkConfirmToken(identity.staging, confirmToken, nowMs);
}

/**
 * Applies a validated preview to the live database under the staging lock, so a
 * second operator cannot drop, reload and merge over this run: fresh full backup,
 * staging load, then one committed transaction per table in foreign-key order.
 *
 * `confirmToken` must be the `reportId` of the `validatePromote` run this
 * promote follows, which is the double confirmation: the operator has seen the
 * measured report, and it is refused once older than `PROMOTE_TOKEN_TTL_MS`
 * because the live database moves on underneath a measurement.
 *
 * A table that fails is rolled back and every later table is left pending;
 * tables already committed stay committed, and re-running with the applied
 * tables set to `skip` resumes exactly the pending ones.
 */
export async function promotePreview(previewId: string, strategies: ApplyStrategies, confirmToken: string): Promise<PromoteReport> {
  await ensurePermission('backup:restore');
  const staging = isPreviewId(previewId) ? stagingSchemaName(previewId) : 'restore_staging_00000000';
  const identity: PromoteIdentity = { previewId, reportId: typeof confirmToken === 'string' ? confirmToken : '', staging };
  const { ok, resolved, unknown } = normalizeStrategies(strategies ?? {});
  const order = applyOrder(resolved);
  const refusal = preconditionError(identity, ok, unknown, order, confirmToken, Date.now());
  if (refusal !== null) return abortPromote(identity, [refusal]);

  const container = previewContainerName(previewId);
  const alive = await settle(runDocker(['exec', container, 'true']));
  if (!alive.ok) return abortPromote(identity, [`Scratch container ${container} is gone; nothing was written.`]);
  const setup = await settle(preparePromote(container, resolved, order));
  if (!setup.ok) return abortPromote(identity, [`Promote refused before writing: ${setup.error}`]);
  if (setup.value.planErrors.length > 0) return abortPromote(identity, setup.value.planErrors, { warnings: setup.value.warnings });
  const locked = await settle(acquireStagingLock(setup.value.env, staging));
  if (!locked.ok) return abortPromote(identity, [`Promote could not take the staging lock: ${locked.error}`]);
  try {
    return await runPromote({ ...identity, container, env: setup.value.env, order, strategies: resolved, facts: setup.value.facts, warnings: setup.value.warnings });
  } finally {
    await locked.value.release();
  }
}

async function runPromote(run: PromoteRun): Promise<PromoteReport> {
  const progress = await startPromoteProgress(run.reportId, run.order.length);
  const gate = await settle(runPrePromoteBackup());
  if (!gate.ok) {
    await progress.finish();
    return abortPromote(run, [`Pre-promote backup gate: ${gate.error}`]);
  }
  await progress.phase('staging');
  const loaded = await settle(loadStaging(run.container, run.env, run.staging, run.order, run.facts, progress));
  if (!loaded.ok) return abortStagingLoad(run, gate.value, loaded.error, progress);
  await progress.phase('applying');
  const applied = await applyTables(run, progress);
  await progress.phase('cleanup');
  const cleanupError = await dropStaging(run.staging, run.env);
  await progress.finish();
  return finish(run, gate.value, applied, cleanupError);
}

/** A staging load that failed wrote nothing live, so staging goes and the run is reported as an abort. */
async function abortStagingLoad(run: PromoteRun, backupEntry: string, error: string, progress: PromoteProgressWriter): Promise<PromoteReport> {
  const cleanupError = await dropStaging(run.staging, run.env);
  await progress.finish();
  return abortPromote(run, [`Staging load failed; no live row was written: ${error}`], { backupEntry, warnings: cleanupError === null ? [] : [cleanupError] });
}

/** One committed transaction per table, stopping at the first failure. */
async function applyTables(run: PromoteRun, progress: PromoteProgressWriter): Promise<ApplyOutcome> {
  const records: TableApplyRecord[] = [];
  const errors: string[] = [];
  for (const table of run.order) {
    await progress.starting(table);
    const applied = await settle(table === LARGE_OBJECT_TABLE
      ? applyLargeObjects(run.container, run.env, run.strategies[table])
      : applyOneTable(run.env, run.staging, table, run.strategies[table], run.strategies, run.facts));
    if (!applied.ok) {
      records.push({ table, strategy: run.strategies[table], status: 'failed', liveBefore: null, liveAfter: null, merged: null, note: applied.error });
      errors.push(`"${table}" failed and every later table was left pending: ${applied.error}`);
      break;
    }
    records.push(applied.value);
    await progress.tableDone(table);
  }
  return { records, errors };
}

async function finish(run: PromoteRun, backupEntry: string, applied: ApplyOutcome, cleanupError: string | null): Promise<PromoteReport> {
  const appliedTables = applied.records.filter((record) => record.status === 'applied').map((record) => record.table);
  const pendingTables = run.order.filter((table) => !appliedTables.includes(table));
  const report: PromoteReport = {
    ok: applied.errors.length === 0 && pendingTables.length === 0,
    previewId: run.previewId, reportId: run.reportId, stagingSchema: run.staging, backupEntry,
    tableRecords: applied.records, appliedTables, pendingTables,
    errors: applied.errors,
    warnings: cleanupError === null ? run.warnings : [...run.warnings, cleanupError],
  };
  return deliver(report);
}

/** A report id this preview was not issued is refused rather than answered, so one run's figure cannot be shown against another's. */
export async function getPromoteStatus(previewId: string, reportId: string): Promise<PromoteStatus> {
  await ensurePermission('backup:restore');
  if (!isPreviewId(previewId) || parseReportId(stagingSchemaName(previewId), reportId) === null) return WAITING_PROGRESS;
  return readPromoteStatus(reportId);
}