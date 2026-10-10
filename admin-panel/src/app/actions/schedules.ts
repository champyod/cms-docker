'use server';

import { revalidatePath } from 'next/cache';

import { recordAudit } from '@/lib/audit';
import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { findDefaultLocation, listBackupLocations } from '@/lib/backup-locations';
import { computeNextRun, validateScheduleInput } from '@/lib/backup-schedules';
import type { ScheduleInput } from '@/lib/backup-schedules';
import { prisma } from '@/lib/prisma';
import { RUN_STATUS_SETTLED, UNFINISHED_RUN_STATUSES, settledRunNote } from '@/scheduler/tick';

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;
/** Same red as the backup-channel embeds in actions/backups.ts. */
const BACKUP_LOG_COLOR = 16_711_680;
/** Same page the backup actions revalidate after a run. */
/** The page the schedule actions revalidate after a mutation. */
const BACKUP_RESTORE_PAGE = '/[locale]/system/backup-restore';

export interface BackupSchedule {
  readonly id: string;
  readonly name: string;
  readonly tables: readonly string[];
  readonly intervalMins: number;
  readonly enabled: boolean;
  readonly lastRunAt: Date | null;
  readonly nextRunAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly locationId: string | null;
}

export interface BackupRun {
  readonly id: string;
  readonly scheduleId: string | null;
  readonly kind: string;
  readonly tables: readonly string[];
  readonly status: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly message: string | null;
  readonly manifestTs: string | null;
}

/** One selectable backup location: the id the schedule stores, the label the form shows. */
export interface BackupLocationOption {
  readonly id: string;
  readonly label: string;
}

/** The schedule form's location choices, plus the id a fresh form preselects. */
export interface LocationOptionsResult {
  readonly success: boolean;
  readonly options?: readonly BackupLocationOption[];
  readonly defaultId?: string;
  readonly error?: string;
}

/** Fields a caller may change; the row's `id` is deliberately not settable. */
export interface ScheduleUpdate {
  readonly name?: string;
  readonly tables?: readonly string[];
  readonly intervalMins?: number;
  readonly enabled?: boolean;
  readonly locationId?: string | null;
}

export interface ScheduleListResult {
  readonly success: boolean;
  readonly schedules?: readonly BackupSchedule[];
  readonly error?: string;
}

export interface RunListResult {
  readonly success: boolean;
  readonly runs?: readonly BackupRun[];
  readonly error?: string;
}

export interface ScheduleMutationResult {
  readonly success: boolean;
  readonly schedule?: BackupSchedule;
  readonly message?: string;
  readonly warnings?: readonly string[];
  readonly error?: string;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Schedule operation failed.';
  return error.message;
}

function clampRunLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_RUN_LIMIT;
  return Math.min(limit, MAX_RUN_LIMIT);
}

/**
 * A schedule that was disabled and is re-enabled must not come back already
 * overdue, and a changed interval must not leave `nextRunAt` on the old
 * cadence. Any other edit leaves the existing due time alone.
 */
function nextRunAtFor(existing: BackupSchedule, update: ScheduleUpdate, now: Date): Date | undefined {
  const reEnabled = update.enabled === true && existing.enabled === false;
  const intervalChanged = update.intervalMins !== undefined && update.intervalMins !== existing.intervalMins;
  if (!reEnabled && !intervalChanged) return undefined;
  return computeNextRun(now, update.intervalMins ?? existing.intervalMins);
}

export async function listSchedules(): Promise<ScheduleListResult> {
  await ensurePermission('backup:schedule');
  try {
    const schedules = await prisma.backup_schedules.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    return { success: true, schedules };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

/** The schedule form's location choices: the rows, with the system row the form preselects. */
export async function listBackupLocationOptions(): Promise<LocationOptionsResult> {
  await ensurePermission('backup:schedule');
  try {
    const [locations, defaultLocation] = await Promise.all([listBackupLocations(), findDefaultLocation()]);
    return {
      success: true,
      options: locations.map((location) => ({ id: location.id, label: location.label })),
      defaultId: defaultLocation?.id ?? locations[0]?.id,
    };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function createSchedule(input: ScheduleInput): Promise<ScheduleMutationResult> {
  await ensurePermission('backup:schedule');
  const knownLocationIds = (await listBackupLocations()).map((location) => location.id);
  const validation = validateScheduleInput(input, knownLocationIds);
  if (!validation.valid || validation.schedule === null) {
    return { success: false, error: validation.errors.join(' ') };
  }
  const { schedule } = validation;
  try {
    const created = await prisma.backup_schedules.create({
      data: {
        name: schedule.name,
        tables: [...schedule.tables],
        intervalMins: schedule.intervalMins,
        locationId: schedule.locationId,
        nextRunAt: computeNextRun(new Date(), schedule.intervalMins),
      },
    });
    await logToDiscord(
      'Backup Schedule Created',
      `Admin created backup schedule **${schedule.name}**, every ${schedule.intervalMins} minute(s) over ${schedule.tables.length} table(s), first run ${created.nextRunAt.toISOString()}.`,
      BACKUP_LOG_COLOR,
    );
    await recordAudit({
      verb: 'backup_schedule:create',
      entity: 'backup_schedule',
      entityId: created.id,
      afterValues: { name: schedule.name, intervalMins: schedule.intervalMins, locationId: schedule.locationId, tableCount: schedule.tables.length },
      result: 'success',
    });
    return { success: true, schedule: created, warnings: validation.warnings };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function updateSchedule(id: string, update: ScheduleUpdate): Promise<ScheduleMutationResult> {
  await ensurePermission('backup:schedule');
  try {
    const existing = await prisma.backup_schedules.findUnique({ where: { id } });
    if (existing === null) return { success: false, error: `Schedule not found: ${id}` };
    const knownLocationIds = (await listBackupLocations()).map((location) => location.id);
    const validation = validateScheduleInput(
      {
        name: update.name ?? existing.name,
        tables: update.tables ?? existing.tables,
        intervalMins: update.intervalMins ?? existing.intervalMins,
        locationId: update.locationId !== undefined ? update.locationId : existing.locationId,
      },
      knownLocationIds,
    );
    if (!validation.valid || validation.schedule === null) {
      return { success: false, error: validation.errors.join(' ') };
    }
    const validated = validation.schedule;
    const nextRunAt = nextRunAtFor(existing, update, new Date());
    const data = {
      ...(update.name !== undefined ? { name: validated.name } : {}),
      ...(update.tables !== undefined ? { tables: [...validated.tables] } : {}),
      ...(update.intervalMins !== undefined ? { intervalMins: validated.intervalMins } : {}),
      ...(update.enabled !== undefined ? { enabled: update.enabled } : {}),
      ...(update.locationId !== undefined ? { locationId: validated.locationId } : {}),
      ...(nextRunAt !== undefined ? { nextRunAt } : {}),
    };
    const saved = await prisma.backup_schedules.update({ where: { id }, data });
    if (Object.keys(data).length > 0) {
      await logToDiscord(
        'Backup Schedule Updated',
        `Admin updated backup schedule **${saved.name}**, every ${saved.intervalMins} minute(s), ${saved.enabled ? 'enabled' : 'disabled'}, next run ${saved.nextRunAt.toISOString()}.`,
        BACKUP_LOG_COLOR,
      );
    }
    await recordAudit({
      verb: 'backup_schedule:update',
      entity: 'backup_schedule',
      entityId: saved.id,
      beforeValues: { name: existing.name, intervalMins: existing.intervalMins, enabled: existing.enabled, locationId: existing.locationId },
      afterValues: { name: saved.name, intervalMins: saved.intervalMins, enabled: saved.enabled, locationId: saved.locationId },
      result: 'success',
    });
    return { success: true, schedule: saved, warnings: validation.warnings };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function toggleSchedule(id: string): Promise<ScheduleMutationResult> {
  await ensurePermission('backup:schedule');
  try {
    const existing = await prisma.backup_schedules.findUnique({ where: { id } });
    if (existing === null) return { success: false, error: `Schedule not found: ${id}` };
    const enabled = !existing.enabled;
    const nextRunAt = computeNextRun(new Date(), existing.intervalMins);
    const saved = await prisma.backup_schedules.update({
      where: { id },
      data: { enabled, ...(enabled ? { nextRunAt } : {}) },
    });
    await logToDiscord(
      enabled ? 'Backup Schedule Enabled' : 'Backup Schedule Disabled',
      `Admin ${enabled ? 'enabled' : 'disabled'} backup schedule **${saved.name}**.`,
      BACKUP_LOG_COLOR,
    );
    await recordAudit({
      verb: 'backup_schedule:update',
      entity: 'backup_schedule',
      entityId: saved.id,
      beforeValues: { enabled: existing.enabled },
      afterValues: { enabled: saved.enabled },
      result: 'success',
    });
    return { success: true, schedule: saved };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function deleteSchedule(id: string): Promise<ScheduleMutationResult> {
  await ensurePermission('backup:delete');
  try {
    const existing = await prisma.backup_schedules.findUnique({ where: { id } });
    if (existing === null) return { success: false, error: `Schedule not found: ${id}` };
    await prisma.backup_schedules.delete({ where: { id } });
    await logToDiscord('Backup Schedule Deleted', `Admin deleted backup schedule **${existing.name}**.`, BACKUP_LOG_COLOR);
    await recordAudit({
      verb: 'backup_schedule:delete',
      entity: 'backup_schedule',
      entityId: existing.id,
      beforeValues: { name: existing.name, intervalMins: existing.intervalMins, enabled: existing.enabled, locationId: existing.locationId },
      result: 'success',
    });
    return { success: true, message: `Deleted schedule ${existing.name}.` };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function listRuns(limit: number = DEFAULT_RUN_LIMIT): Promise<RunListResult> {
  await ensurePermission('backup:schedule');
  try {
    const runs = await prisma.backup_runs.findMany({
      orderBy: { startedAt: 'desc' },
      take: clampRunLimit(limit),
    });
    return { success: true, runs };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

/**
 * Releases a run the scheduler claimed and never resolved. The row is `started`
 * only because the poller died between writing it and learning the outcome, so
 * settling says the row is closed, never that the backup succeeded: the real
 * result is in Discord and backups/manifest.json.
 */
export async function settleRun(runId: string, note?: string): Promise<ScheduleMutationResult> {
  await ensurePermission('backup:settle');
  try {
    const existing = await prisma.backup_runs.findUnique({ where: { id: runId }, select: { id: true, status: true } });
    if (existing === null) return { success: false, error: `Run not found: ${runId}` };
    if (!UNFINISHED_RUN_STATUSES.includes(existing.status)) {
      return { success: false, error: `Run is already ${existing.status}; only an unfinished run can be settled.` };
    }
    const saved = await prisma.backup_runs.update({
      where: { id: runId },
      data: { status: RUN_STATUS_SETTLED, finishedAt: new Date(), message: settledRunNote(note) },
    });
    await logToDiscord(
      'Backup Run Settled',
      `Admin settled backup run ${saved.id} (${saved.kind}, ${saved.tables.length} table(s), was ${existing.status}). Its schedule can fire again; the real result is in backups/manifest.json.`,
      BACKUP_LOG_COLOR,
    );
    revalidatePath(BACKUP_RESTORE_PAGE, 'page');
    await recordAudit({
      verb: 'backup_run:settle',
      entity: 'backup_run',
      entityId: saved.id,
      beforeValues: { status: existing.status },
      afterValues: { status: saved.status },
      reason: note,
      result: 'success',
    });
    return { success: true, message: `Settled run ${saved.id}.` };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}
