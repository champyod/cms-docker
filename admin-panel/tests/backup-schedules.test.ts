import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_INTERVAL_MINS,
  MAX_NAME_LENGTH,
  MIN_INTERVAL_MINS,
  computeNextRun,
  isScheduleDue,
  validateScheduleInput,
} from '@/lib/backup-schedules';
import type { ScheduleInput } from '@/lib/backup-schedules';

const SCHEMA_SOURCE = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');
const MIGRATION_SOURCE = readFileSync(
  fileURLToPath(new URL('../prisma/migrations/20261002120000_backup_schedules/migration.sql', import.meta.url)),
  'utf8',
);
const LOCATION_MIGRATION_SOURCE = readFileSync(
  fileURLToPath(new URL('../prisma/migrations/20261007000000_backup_schedule_location/migration.sql', import.meta.url)),
  'utf8',
);

/** One UTC instant, so no assertion depends on the machine's timezone. */
const REFERENCE = new Date('2026-03-01T12:00:00.000Z');
const MINUTE_MS = 60_000;

function parseSchemaModels(source: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const [, modelName, body] of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.set(modelName, body);
  }
  return models;
}

const SCHEMA_MODELS = parseSchemaModels(SCHEMA_SOURCE);

function fieldLine(model: string, field: string): string {
  const body = SCHEMA_MODELS.get(model);
  if (body === undefined) throw new Error(`model ${model} is missing from schema.prisma`);
  const line = body.split('\n').find((entry) => entry.match(new RegExp(`^\\s+${field}\\s+\\S`)));
  if (line === undefined) throw new Error(`model ${model} has no field ${field}`);
  // prisma format aligns columns inside a model, so the padding is not part of the declaration.
  return line.trim().replace(/\s+/g, ' ');
}

function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { name: 'nightly', tables: ['contests', 'users', 'teams'], intervalMins: 60, ...overrides };
}

describe('computeNextRun', () => {
  it('adds the interval as absolute UTC milliseconds', () => {
    expect(computeNextRun(REFERENCE, 60).toISOString()).toBe('2026-03-01T13:00:00.000Z');
  });

  it('accepts the minimum interval', () => {
    expect(computeNextRun(REFERENCE, MIN_INTERVAL_MINS).getTime()).toBe(REFERENCE.getTime() + 5 * MINUTE_MS);
  });

  it('accepts the maximum interval of thirty days', () => {
    expect(computeNextRun(REFERENCE, MAX_INTERVAL_MINS).toISOString()).toBe('2026-03-31T12:00:00.000Z');
  });

  it('does not shift across a DST transition, because it never touches local time', () => {
    // 2026-03-08 is the European spring-forward day; a calendar addition would
    // lose or gain an hour here depending on the host timezone.
    const beforeTransition = new Date('2026-03-07T12:00:00.000Z');
    const afterTransition = new Date('2026-03-09T12:00:00.000Z');
    expect(computeNextRun(beforeTransition, 1440).toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(computeNextRun(afterTransition, 1440).toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });

  it('leaves the given instant untouched', () => {
    computeNextRun(REFERENCE, 90);
    expect(REFERENCE.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });
});

describe('isScheduleDue', () => {
  const dueAt = REFERENCE;

  it('is not due one millisecond before', () => {
    expect(isScheduleDue(dueAt, new Date(dueAt.getTime() - 1))).toBe(false);
  });

  it('is due exactly at the due time', () => {
    expect(isScheduleDue(dueAt, new Date(dueAt.getTime()))).toBe(true);
  });

  it('stays due after the due time', () => {
    expect(isScheduleDue(dueAt, new Date(dueAt.getTime() + 1))).toBe(true);
    expect(isScheduleDue(dueAt, new Date(dueAt.getTime() + 24 * 60 * MINUTE_MS))).toBe(true);
  });

  it('defaults the comparison to the current wall clock', () => {
    expect(isScheduleDue(new Date(Date.now() - MINUTE_MS))).toBe(true);
    expect(isScheduleDue(new Date(Date.now() + MINUTE_MS))).toBe(false);
  });
});

describe('validateScheduleInput', () => {
  it('accepts a valid schedule and returns it normalized', () => {
    const result = validateScheduleInput(scheduleInput());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.schedule).toEqual({ name: 'nightly', tables: ['contests', 'users', 'teams'], intervalMins: 60, locationId: null });
  });

  it('normalizes an absent location to null, the default tree', () => {
    expect(validateScheduleInput(scheduleInput(), ['default']).schedule?.locationId).toBeNull();
  });

  it('accepts a location id the caller knows', () => {
    const result = validateScheduleInput(scheduleInput({ locationId: 'secondary' }), ['default', 'secondary']);
    expect(result.valid).toBe(true);
    expect(result.schedule?.locationId).toBe('secondary');
  });

  it('rejects a location id outside the registry instead of storing it', () => {
    const result = validateScheduleInput(scheduleInput({ locationId: 'ghost' }), ['default']);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Unknown backup location: ghost']);
    expect(result.schedule).toBeNull();
  });

  it('rejects every id when the caller passes no registry', () => {
    const result = validateScheduleInput(scheduleInput({ locationId: 'default' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Unknown backup location: default']);
  });

  it('rejects a blank location id', () => {
    const result = validateScheduleInput(scheduleInput({ locationId: '' }), ['default']);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Backup location must be a location id or empty for the default tree.']);
  });

  it('trims the name and stores tables in catalog order without duplicates', () => {
    const result = validateScheduleInput(scheduleInput({ name: '  nightly  ', tables: ['users', 'contests', 'users'] }));
    expect(result.schedule?.name).toBe('nightly');
    expect(result.schedule?.tables).toEqual(['contests', 'users']);
  });

  it('carries the catalog warnings through instead of swallowing them', () => {
    const result = validateScheduleInput(scheduleInput({ tables: ['contests', 'users', 'teams', 'tasks', 'participations', 'submissions'] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toContain('fsobjects');
  });

  it('rejects a table outside the catalog', () => {
    const result = validateScheduleInput(scheduleInput({ tables: ['contests', 'monitor_targets'] }));
    expect(result.valid).toBe(false);
    expect(result.schedule).toBeNull();
    expect(result.errors).toEqual(['Not in the backup table catalog: monitor_targets']);
  });

  it('rejects an empty selection that would dump the whole database', () => {
    const result = validateScheduleInput(scheduleInput({ tables: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['At least one table must be selected.']);
  });

  it('rejects a selection that is not a list of names', () => {
    const result = validateScheduleInput(scheduleInput({ tables: [42] as unknown as string[] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Table selection must be a list of names.']);
  });

  it('rejects a blank name', () => {
    expect(validateScheduleInput(scheduleInput({ name: '   ' })).errors).toEqual(['Schedule name is required.']);
  });

  it('rejects a name longer than the column allows', () => {
    const result = validateScheduleInput(scheduleInput({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(String(MAX_NAME_LENGTH));
  });

  it('accepts a name exactly at the length limit', () => {
    expect(validateScheduleInput(scheduleInput({ name: 'x'.repeat(MAX_NAME_LENGTH) })).valid).toBe(true);
  });

  it('accepts both interval bounds', () => {
    expect(validateScheduleInput(scheduleInput({ intervalMins: MIN_INTERVAL_MINS })).valid).toBe(true);
    expect(validateScheduleInput(scheduleInput({ intervalMins: MAX_INTERVAL_MINS })).valid).toBe(true);
  });

  it('rejects an interval one minute below the minimum', () => {
    const result = validateScheduleInput(scheduleInput({ intervalMins: MIN_INTERVAL_MINS - 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([`Interval must be at least ${MIN_INTERVAL_MINS} minutes.`]);
  });

  it('rejects an interval one minute above the maximum', () => {
    const result = validateScheduleInput(scheduleInput({ intervalMins: MAX_INTERVAL_MINS + 1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([`Interval must be at most ${MAX_INTERVAL_MINS} minutes.`]);
  });

  it('rejects a fractional interval', () => {
    const result = validateScheduleInput(scheduleInput({ intervalMins: 5.5 }));
    expect(result.errors).toEqual(['Interval must be a whole number of minutes.']);
  });

  it('rejects an interval that is not a number', () => {
    const result = validateScheduleInput(scheduleInput({ intervalMins: 'sixty' as unknown as number }));
    expect(result.errors).toEqual(['Interval must be a whole number of minutes.']);
  });

  it('reports every problem at once instead of only the first', () => {
    const result = validateScheduleInput(scheduleInput({ name: '', tables: ['nope'], intervalMins: 0 }));
    expect(result.errors).toHaveLength(3);
  });
});

describe('schedule schema parity', () => {
  it('declares backup_schedules with every column the actions read and write', () => {
    expect(fieldLine('backup_schedules', 'id')).toBe('id String @id @default(cuid())');
    expect(fieldLine('backup_schedules', 'name')).toBe('name String @unique');
    expect(fieldLine('backup_schedules', 'tables')).toBe('tables String[] @db.VarChar');
    expect(fieldLine('backup_schedules', 'intervalMins')).toBe('intervalMins Int');
    expect(fieldLine('backup_schedules', 'enabled')).toBe('enabled Boolean @default(true)');
    expect(fieldLine('backup_schedules', 'lastRunAt')).toBe('lastRunAt DateTime?');
    expect(fieldLine('backup_schedules', 'nextRunAt')).toBe('nextRunAt DateTime');
    expect(fieldLine('backup_schedules', 'locationId')).toBe('locationId String?');
    expect(fieldLine('backup_schedules', 'createdAt')).toBe('createdAt DateTime @default(now())');
    expect(fieldLine('backup_schedules', 'updatedAt')).toBe('updatedAt DateTime @updatedAt');
  });

  it('declares backup_runs with a nullable scheduleId so manual runs need no schedule', () => {
    expect(fieldLine('backup_runs', 'id')).toBe('id String @id @default(cuid())');
    expect(fieldLine('backup_runs', 'scheduleId')).toBe('scheduleId String?');
    expect(fieldLine('backup_runs', 'kind')).toBe('kind String');
    expect(fieldLine('backup_runs', 'tables')).toBe('tables String[] @db.VarChar');
    expect(fieldLine('backup_runs', 'status')).toBe('status String');
    expect(fieldLine('backup_runs', 'startedAt')).toBe('startedAt DateTime @default(now())');
    expect(fieldLine('backup_runs', 'finishedAt')).toBe('finishedAt DateTime?');
    expect(fieldLine('backup_runs', 'message')).toBe('message String?');
    expect(fieldLine('backup_runs', 'manifestTs')).toBe('manifestTs String?');
  });

  it('keeps run history out of the schedule relation, so deleting a schedule keeps it', () => {
    expect(SCHEMA_MODELS.get('backup_runs')).not.toContain('@relation');
  });

  it('has a migration that creates both tables', () => {
    expect(MIGRATION_SOURCE).toContain('CREATE TABLE "backup_schedules"');
    expect(MIGRATION_SOURCE).toContain('CREATE TABLE "backup_runs"');
    expect(MIGRATION_SOURCE).toContain('CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")');
    expect(MIGRATION_SOURCE).toContain('CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")');
  });

  it('has a migration that adds locationId, so deploys upgrade without a reset', () => {
    expect(LOCATION_MIGRATION_SOURCE).toContain('ALTER TABLE "backup_schedules" ADD COLUMN "locationId" TEXT');
  });
});
