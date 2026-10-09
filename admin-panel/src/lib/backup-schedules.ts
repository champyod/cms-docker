/**
 * Pure scheduling logic for recurring selective backups.
 *
 * No node-only and no Prisma imports: the admin server actions, the backup
 * poller and tests all import this module, and none of them need a database to
 * decide when a schedule is due or whether its input is safe to persist.
 *
 * Table names reach `pg_dump` as shell arguments through the backup path, so
 * the catalog stays the single allowlist: this module validates through
 * `validateTableSelection` rather than re-deriving its own idea of a table.
 */

import { BACKUP_TABLES, validateTableSelection } from '@/lib/backup-table-catalog';

export const MIN_INTERVAL_MINS = 5;
export const MAX_INTERVAL_MINS = 43_200;
export const MAX_NAME_LENGTH = 100;

const MS_PER_MINUTE = 60_000;

export interface ScheduleInput {
  readonly name: string;
  readonly tables: readonly string[];
  readonly intervalMins: number;
  /** Backup location id; null selects the default tree, as every pre-location row does. */
  readonly locationId?: string | null;
}

/** A schedule that passed validation, normalized for persistence. */
export interface ValidatedSchedule {
  readonly name: string;
  readonly tables: readonly string[];
  readonly intervalMins: number;
  readonly locationId: string | null;
}

export interface ScheduleValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly schedule: ValidatedSchedule | null;
}

interface TablesCheck {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly tables: readonly string[];
}

/**
 * Plain millisecond arithmetic on the absolute time axis, never a local-time
 * calendar addition, so the result does not shift across a DST transition.
 */
export function computeNextRun(from: Date, intervalMins: number): Date {
  return new Date(from.getTime() + intervalMins * MS_PER_MINUTE);
}

/** A poller that wakes up a millisecond late must still fire the schedule. */
export function isScheduleDue(nextRunAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= nextRunAt.getTime();
}

/**
 * Catalog order is parent-before-child, so storing a selection in that order
 * makes two schedules naming the same tables hold the same value.
 */
function orderSelection(tables: readonly string[]): string[] {
  const selected = new Set(tables);
  return BACKUP_TABLES.filter((table) => selected.has(table.name)).map((table) => table.name);
}

function checkName(name: unknown): string[] {
  if (typeof name !== 'string' || name.trim().length === 0) return ['Schedule name is required.'];
  if (name.trim().length > MAX_NAME_LENGTH) return [`Schedule name must be ${MAX_NAME_LENGTH} characters or fewer.`];
  return [];
}

/**
 * A schedule naming no table names every table. The selection is stored empty and
 * resolved to the whole catalog by the scheduler, at the argv boundary, so a row
 * written here, by hand or by a migration resolves the same way; the catalog's own
 * empty-selection warning is carried so the operator is told the dump covers the
 * whole database rather than handed a different thing without a word.
 *
 * `validateTableSelection` keeps rejecting empty for the manual-run, export and
 * restore paths, none of which has that resolver, so only the unreachable-here
 * emptiness is relaxed — an unknown name is still refused.
 */
function checkTables(tables: unknown): TablesCheck {
  if (!Array.isArray(tables) || !tables.every((table) => typeof table === 'string')) {
    return { errors: ['Table selection must be a list of names.'], warnings: [], tables: [] };
  }
  const selection = validateTableSelection(tables);
  if (selection.unknown.length > 0) {
    return { errors: [`Not in the backup table catalog: ${selection.unknown.join(', ')}`], warnings: [], tables: [] };
  }
  if (tables.length === 0) {
    return { errors: [], warnings: selection.warnings, tables: [] };
  }
  return { errors: [], warnings: selection.warnings, tables: orderSelection(tables) };
}

function checkInterval(intervalMins: unknown): string[] {
  if (typeof intervalMins !== 'number' || !Number.isInteger(intervalMins)) {
    return ['Interval must be a whole number of minutes.'];
  }
  if (intervalMins < MIN_INTERVAL_MINS) return [`Interval must be at least ${MIN_INTERVAL_MINS} minutes.`];
  if (intervalMins > MAX_INTERVAL_MINS) return [`Interval must be at most ${MAX_INTERVAL_MINS} minutes.`];
  return [];
}

/**
 * Null is always valid — it is what every row that predates locations carries,
 * and it targets the default tree. An id must appear in `knownLocationIds`,
 * which defaults empty so a caller that forgets to pass the registry rejects
 * every id instead of accepting one that may not exist.
 */
function checkLocationId(locationId: unknown, knownLocationIds: readonly string[]): string[] {
  if (locationId === undefined || locationId === null) return [];
  if (typeof locationId !== 'string' || locationId.length === 0) {
    return ['Backup location must be a location id or empty for the default tree.'];
  }
  if (!knownLocationIds.includes(locationId)) return [`Unknown backup location: ${locationId}`];
  return [];
}

export function validateScheduleInput(
  input: ScheduleInput,
  knownLocationIds: readonly string[] = [],
): ScheduleValidationResult {
  const name = checkName(input.name);
  const tables = checkTables(input.tables);
  const interval = checkInterval(input.intervalMins);
  const location = checkLocationId(input.locationId, knownLocationIds);
  const errors = [...name, ...tables.errors, ...interval, ...location];
  if (errors.length > 0) return { valid: false, errors, warnings: [], schedule: null };
  return {
    valid: true,
    errors: [],
    warnings: tables.warnings,
    schedule: {
      name: input.name.trim(),
      tables: tables.tables,
      intervalMins: input.intervalMins,
      locationId: input.locationId ?? null,
    },
  };
}
