/**
 * Pure decision logic for one backup-scheduler tick.
 *
 * No Prisma, no child process, no clock, no timers: everything here is a
 * function of its arguments, so `runner.ts` can be the only module that touches
 * the database and the Docker socket, and the tests need neither of them.
 *
 * Table names become argv entries for `pg_dump` inside cms-monitor, so a name is
 * only ever re-admitted here through the catalog allowlist. A stored selection is
 * therefore re-validated on every launch: the catalog can lose a table between
 * the write and the fire, and a stale row must not reach `pg_dump`.
 */

import { BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';
import { isScheduleDue } from '@/lib/backup-schedules';

export const MONITOR_CONTAINER = 'cms-monitor';
export const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';

export const RUN_KIND = 'schedule';
export const RUN_STATUS_STARTED = 'started';
export const RUN_STATUS_LAUNCHED = 'launched';
export const RUN_STATUS_FAILED = 'failed';

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

const REJECTED_UNKNOWN_TABLES = 'Not in the backup table catalog';
const REJECTED_EMPTY_SELECTION = 'At least one table must be selected.';
const REJECTED_NOT_A_LIST = 'Table selection must be a list of names.';

/** The `ix_backup_schedules_enabled_next_run_at` index answers exactly this predicate. */
export function buildDueScheduleFilter(now: Date): DueScheduleFilter {
  return { enabled: true, nextRunAt: { lte: now } };
}

/**
 * The overlap guard: a schedule whose previous fire is still unresolved is left
 * alone, so one schedule can never queue a second dump behind its own. Nothing
 * resolves a `started` row, so a launch that died unobserved holds the schedule
 * back rather than letting it overlap an unknown state.
 */
export function buildUnfinishedRunFilter(scheduleId: string): UnfinishedRunFilter {
  return { scheduleId, status: { in: [...UNFINISHED_RUN_STATUSES] } };
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

function buildArgv(tables: readonly string[], includeLargeObjects: boolean): string[] {
  const args = ['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', tables.join(',')];
  if (includeLargeObjects) args.push('--large-objects');
  return args;
}

/**
 * The argv `docker exec -d cms-monitor bash cms-backup.sh` is given, built from
 * catalog-validated names only. An empty selection is refused rather than
 * emitted, because `pg_dump` with no `-t` dumps the whole database.
 */
export function buildBackupArgv(tables: readonly string[]): BackupArgvResult {
  if (!Array.isArray(tables) || !tables.every((table) => typeof table === 'string')) {
    return rejection(REJECTED_NOT_A_LIST);
  }
  const validation = validateTableSelection([...tables]);
  if (validation.unknown.length > 0) return rejection(`${REJECTED_UNKNOWN_TABLES}: ${validation.unknown.join(', ')}`);
  if (!validation.valid) return rejection(REJECTED_EMPTY_SELECTION);
  const selection = orderSelection(tables);
  return { valid: true, tables: selection, args: buildArgv(selection, selectionNeedsLargeObjects(selection)), error: null };
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
 * schedule back until an operator settles the row. The note says so instead of
 * naming a status the poller cannot honestly report.
 */
export function startedRunNote(): string {
  return 'Scheduler claimed this run and never observed cms-monitor finish it; the real result is in Discord and backups/manifest.json. A row left in started blocks its schedule until an operator settles it.';
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
