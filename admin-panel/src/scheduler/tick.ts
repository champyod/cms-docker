/**
 * Pure decision logic for one backup-scheduler tick.
 *
 * No Prisma, no child process, no clock, no timers: everything here is a
 * function of its arguments and of the store, launcher and location ports
 * `runner.ts` hands in, so `runner.ts` can be the only module that touches the
 * database, the config env and the Docker socket, and the tests need none of them.
 *
 * Table names become argv entries for `pg_dump` inside cms-monitor, so a name is
 * only ever re-admitted here through the catalog allowlist. A stored selection is
 * therefore re-validated on every launch: the catalog can lose a table between
 * the write and the fire, and a stale row must not reach `pg_dump`.
 */

import { isAbsolute } from 'node:path';

import { BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';
import { computeNextRun, isScheduleDue } from '@/lib/backup-schedules';
import type { WriteRootResolution } from '@/lib/backup-locations';

export const MONITOR_CONTAINER = 'cms-monitor';
export const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';

export const RUN_KIND = 'schedule';
export const RUN_STATUS_STARTED = 'started';
export const RUN_STATUS_LAUNCHED = 'launched';
export const RUN_STATUS_FAILED = 'failed';
/** Terminal, and written by nobody the poller owns: an operator, or boot reconciliation. */
export const RUN_STATUS_SETTLED = 'settled';

const MS_PER_MINUTE = 60_000;
const STALE_RUN_MAX_AGE_HOURS = 24;

const LARGE_OBJECT_TABLES: ReadonlySet<string> = new Set(
  BACKUP_TABLES.filter((table) => table.needsLargeObjects === true).map((table) => table.name),
);

/** The only status that still owns a pending launch; everything else is settled. */
export const UNFINISHED_RUN_STATUSES: readonly string[] = [RUN_STATUS_STARTED];

export interface DueScheduleRow {
  readonly id: string;
  readonly name: string;
  readonly tables: readonly string[];
  readonly intervalMins: number;
  readonly enabled: boolean;
  readonly nextRunAt: Date;
  /** Config location id; null targets the configured default, as every pre-location row does. */
  readonly locationId: string | null;
}

export interface DueScheduleFilter {
  readonly enabled: true;
  readonly nextRunAt: { readonly lte: Date };
}

export interface UnfinishedRunFilter {
  readonly scheduleId: string;
  readonly status: { readonly in: string[] };
}

export interface BackupArgvResult {
  readonly valid: boolean;
  readonly tables: readonly string[];
  readonly args: string[];
  readonly error: string | null;
}

export interface StartedRunInput {
  readonly scheduleId: string;
  readonly tables: readonly string[];
  readonly startedAt: Date;
}

/** The started row as the poller decided it, note included. */
export interface StartedRunRecord extends StartedRunInput {
  readonly message: string;
}

export interface ScheduleCadence {
  readonly lastRunAt: Date;
  readonly nextRunAt: Date;
}

export interface RunOutcome {
  readonly status: string;
  readonly message: string;
  readonly finishedAt: Date | null;
}

export interface StaleRunFilter {
  readonly status: string;
  readonly startedAt: { readonly lte: Date };
}

/** Every database write the poller owns, so the tests can stand in for the client. */
export interface SchedulerStore {
  findDueSchedules(now: Date): Promise<readonly DueScheduleRow[]>;
  findStaleRunIds(now: Date): Promise<readonly string[]>;
  findUnfinishedRunId(scheduleId: string): Promise<string | null>;
  createStartedRun(record: StartedRunRecord): Promise<string>;
  advanceSchedule(schedule: DueScheduleRow, cadence: ScheduleCadence): Promise<void>;
  updateRun(runId: string, outcome: RunOutcome): Promise<void>;
  settleRun(runId: string, message: string): Promise<void>;
}

export interface ScheduleLauncher {
  /** Rejects when the exec itself fails; it never resolves with a dump result. */
  launch(args: readonly string[]): Promise<void>;
  alert(title: string, body: string): Promise<void>;
}

export interface SchedulerDeps {
  readonly store: SchedulerStore;
  readonly launcher: ScheduleLauncher;
  /** Resolves where a due schedule writes; injected so config env stays out of this module. */
  readonly resolveWriteRoot: (locationId: string | null) => WriteRootResolution;
  readonly shouldStop: () => boolean;
}

const REJECTED_UNKNOWN_TABLES = 'Not in the backup table catalog';
const REJECTED_EMPTY_SELECTION = 'At least one table must be selected.';
const REJECTED_NOT_A_LIST = 'Table selection must be a list of names.';

/** The `ix_backup_schedules_enabled_next_run_at` index answers exactly this predicate. */
export function buildDueScheduleFilter(now: Date): DueScheduleFilter {
  return { enabled: true, nextRunAt: { lte: now } };
}

/**
 * The overlap guard: a schedule whose previous fire is still unresolved is left
 * alone, so one schedule can never queue a second dump behind its own. A launch
 * that died unobserved holds the schedule back until its row is settled, which is
 * why `settled` has to stay out of the unfinished set.
 */
export function buildUnfinishedRunFilter(scheduleId: string): UnfinishedRunFilter {
  return { scheduleId, status: { in: [...UNFINISHED_RUN_STATUSES] } };
}

/**
 * A `started` row older than a day cannot belong to a launch this process
 * started, so it is a row a dead process left behind and the boot sweep settles.
 */
export function buildStaleRunFilter(now: Date): StaleRunFilter {
  return { status: RUN_STATUS_STARTED, startedAt: { lte: new Date(now.getTime() - STALE_RUN_MAX_AGE_HOURS * 60 * MS_PER_MINUTE) } };
}

/**
 * The one cadence policy: whatever else happens to a fire, the schedule is due
 * again on its own interval afterwards instead of on every tick from now on.
 */
export function computeCadence(schedule: DueScheduleRow, now: Date): ScheduleCadence {
  return { lastRunAt: now, nextRunAt: computeNextRun(now, schedule.intervalMins) };
}

/**
 * Re-checks the predicate the filter expresses. A row can also become due inside
 * the same tick that read it, or be disabled in the window between the two
 * queries, so the poller does not act on the index alone.
 */
export function selectDueSchedules<T extends DueScheduleRow>(rows: readonly T[], now: Date): T[] {
  return rows.filter((row) => row.enabled && isScheduleDue(row.nextRunAt, now));
}

/** Catalog order is parent-before-child, so it is also the order pg_dump must restore in. */
function orderSelection(tables: readonly string[]): string[] {
  const selected = new Set(tables);
  return BACKUP_TABLES.filter((table) => selected.has(table.name)).map((table) => table.name);
}

export function selectionNeedsLargeObjects(tables: readonly string[]): boolean {
  return tables.some((name) => LARGE_OBJECT_TABLES.has(name));
}

function rejection(error: string): BackupArgvResult {
  return { valid: false, tables: [], args: [], error };
}

function buildArgv(tables: readonly string[], includeLargeObjects: boolean, writeRoot: string | null): string[] {
  const args = ['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', tables.join(',')];
  if (includeLargeObjects) args.push('--large-objects');
  if (writeRoot !== null) args.push('--root', writeRoot);
  return args;
}

/**
 * The argv `docker exec -d cms-monitor bash cms-backup.sh` is given, built from
 * catalog-validated names only. An empty selection is refused rather than
 * emitted, because `pg_dump` with no `-t` dumps the whole database. A non-null
 * writeRoot must be absolute: a relative one would resolve against the
 * monitor's working directory and silently land somewhere else.
 */
export function buildBackupArgv(tables: readonly string[], writeRoot: string | null = null): BackupArgvResult {
  if (!Array.isArray(tables) || !tables.every((table) => typeof table === 'string')) {
    return rejection(REJECTED_NOT_A_LIST);
  }
  if (writeRoot !== null && !isAbsolute(writeRoot)) {
    return rejection(`Backup root must be an absolute path: ${writeRoot}`);
  }
  const validation = validateTableSelection([...tables]);
  if (validation.unknown.length > 0) return rejection(`${REJECTED_UNKNOWN_TABLES}: ${validation.unknown.join(', ')}`);
  if (!validation.valid) return rejection(REJECTED_EMPTY_SELECTION);
  const selection = orderSelection(tables);
  return {
    valid: true,
    tables: selection,
    args: buildArgv(selection, selectionNeedsLargeObjects(selection), writeRoot),
    error: null,
  };
}

export function buildStartedRun(input: StartedRunInput): {
  scheduleId: string;
  kind: string;
  tables: string[];
  status: string;
  startedAt: Date;
} {
  return {
    scheduleId: input.scheduleId,
    kind: RUN_KIND,
    tables: [...input.tables],
    status: RUN_STATUS_STARTED,
    startedAt: input.startedAt,
  };
}

/**
 * A row is written before the exec, so a container that dies mid-launch leaves a
 * `started` row this poller never resolves, and the overlap guard then holds that
 * schedule back until the row is settled. The note says so instead of naming a
 * status the poller cannot honestly report.
 */
export function startedRunNote(): string {
  return 'Scheduler claimed this run and never observed cms-monitor finish it; the real result is in Discord and backups/manifest.json. A row left in started blocks its schedule until the row is settled.';
}

/** Settling releases the schedule; it claims nothing about how the dump went. */
export function settledRunNote(operatorNote?: string): string {
  const reason = operatorNote !== undefined && operatorNote.trim().length > 0 ? ` ${operatorNote.trim()}` : '';
  return `Settled by an operator${reason}. The scheduler never observed ${MONITOR_CONTAINER} finish this run, so the real result is in Discord and backups/manifest.json.`;
}

export function reconciledRunNote(): string {
  return `reconciled on boot: this started row was already older than ${STALE_RUN_MAX_AGE_HOURS}h when the scheduler restarted, so no live launch owned it and the schedule was released instead of staying blocked.`;
}

export function launchedRunNote(scheduleName: string, tableCount: number): string {
  return `Scheduler handed a detached dump of ${tableCount} table(s) to ${MONITOR_CONTAINER} on behalf of ${scheduleName}; the final result is not observed by the scheduler.`;
}

export function failedRunNote(reason: string): string {
  return `Scheduler could not start the dump: ${reason}`;
}

/** stderr carries the docker CLI's own complaint, which the message alone drops. */
export function describeExecFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Backup launch failed.';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return stderr.length > 0 ? `${error.message}: ${stderr}` : error.message;
}

/**
 * A schedule whose stored selection no longer validates is not a fire at all,
 * but it is still a fire the cadence must move past: leaving `nextRunAt` behind
 * would re-read the same bad row every tick and alert every tick. The cadence is
 * written before the alert, so a failed alert cannot re-arm the retry either.
 */
async function rejectSchedule(schedule: DueScheduleRow, argv: BackupArgvResult, now: Date, deps: SchedulerDeps): Promise<void> {
  await deps.store.advanceSchedule(schedule, computeCadence(schedule, now));
  await deps.launcher.alert(
    'Scheduled Backup Rejected',
    `Schedule **${schedule.name}** was skipped: ${argv.error} It will be retried on its own interval until its configuration is fixed.`,
  );
}

async function launchRun(schedule: DueScheduleRow, argv: BackupArgvResult, runId: string, now: Date, deps: SchedulerDeps): Promise<void> {
  try {
    await deps.launcher.launch(argv.args);
    await deps.store.updateRun(runId, { status: RUN_STATUS_LAUNCHED, message: launchedRunNote(schedule.name, argv.tables.length), finishedAt: null });
    await deps.launcher.alert(
      'Scheduled Backup Launched',
      `Schedule **${schedule.name}** handed a detached dump of ${argv.tables.length} table(s) to ${MONITOR_CONTAINER}. Follow this channel for the result.`,
    );
  } catch (error) {
    const reason = describeExecFailure(error);
    await deps.store.updateRun(runId, { status: RUN_STATUS_FAILED, message: failedRunNote(reason), finishedAt: now });
    await deps.launcher.alert('Scheduled Backup Failed', `Schedule **${schedule.name}** could not start its dump: ${reason}`);
  }
}

/** Claims the run, moves the cadence on, and only then hands the dump over. */
async function launchSchedule(schedule: DueScheduleRow, argv: BackupArgvResult, now: Date, deps: SchedulerDeps): Promise<void> {
  const runId = await deps.store.createStartedRun({ scheduleId: schedule.id, tables: argv.tables, startedAt: now, message: startedRunNote() });
  await deps.store.advanceSchedule(schedule, computeCadence(schedule, now));
  await launchRun(schedule, argv, runId, now, deps);
}

/**
 * An unknown location id is a config drift, not a dump: it is reported the same
 * way a stale table selection is — cadence advances, the operator is alerted —
 * rather than silently redirected to the default tree.
 */
export async function fireSchedule(schedule: DueScheduleRow, now: Date, deps: SchedulerDeps): Promise<void> {
  const writeRoot = deps.resolveWriteRoot(schedule.locationId);
  if (!writeRoot.ok) {
    await rejectSchedule(schedule, { valid: false, tables: [], args: [], error: writeRoot.error }, now, deps);
    return;
  }
  const argv = buildBackupArgv(schedule.tables, writeRoot.root);
  if (!argv.valid) {
    await rejectSchedule(schedule, argv, now, deps);
    return;
  }
  if ((await deps.store.findUnfinishedRunId(schedule.id)) !== null) return;
  await launchSchedule(schedule, argv, now, deps);
}

export async function fireDueSchedules(candidates: readonly DueScheduleRow[], now: Date, deps: SchedulerDeps): Promise<void> {
  for (const schedule of selectDueSchedules(candidates, now)) {
    if (deps.shouldStop()) return;
    await fireSchedule(schedule, now, deps);
  }
}

/**
 * Boot sweep for rows a dead scheduler left `started`: they hold their schedule
 * back forever, and no live launch can still own one this old. Settling them
 * says only that the poller stopped tracking them, and one alert names the count.
 */
export async function reconcileStaleRuns(now: Date, deps: SchedulerDeps): Promise<number> {
  const staleRunIds = await deps.store.findStaleRunIds(now);
  if (staleRunIds.length === 0) return 0;
  for (const runId of staleRunIds) await deps.store.settleRun(runId, reconciledRunNote());
  await deps.launcher.alert(
    'Backup Runs Reconciled',
    `${staleRunIds.length} run(s) were left unfinished by an earlier scheduler process and have been settled on boot; their real results are in Discord and backups/manifest.json.`,
  );
  return staleRunIds.length;
}
