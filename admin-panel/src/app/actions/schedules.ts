'use server';

import { logToDiscord } from '@/lib/discord-notifier';
import { ensurePermission } from '@/lib/permissions';
import { computeNextRun, validateScheduleInput } from '@/lib/backup-schedules';
import type { ScheduleInput } from '@/lib/backup-schedules';
import { prisma } from '@/lib/prisma';

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;
/** Same red as the backup-channel embeds in actions/backups.ts. */
const BACKUP_LOG_COLOR = 16_711_680;

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

/** Fields a caller may change; the row's `id` is deliberately not settable. */
export interface ScheduleUpdate {
  readonly name?: string;
  readonly tables?: readonly string[];
  readonly intervalMins?: number;
  readonly enabled?: boolean;
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
  await ensurePermission('all');
  try {
    const schedules = await prisma.backup_schedules.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    return { success: true, schedules };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function createSchedule(input: ScheduleInput): Promise<ScheduleMutationResult> {
  await ensurePermission('all');
  const validation = validateScheduleInput(input);
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
        nextRunAt: computeNextRun(new Date(), schedule.intervalMins),
      },
    });
    await logToDiscord(
      'Backup Schedule Created',
      `Admin created backup schedule **${schedule.name}**, every ${schedule.intervalMins} minute(s) over ${schedule.tables.length} table(s), first run ${created.nextRunAt.toISOString()}.`,
      BACKUP_LOG_COLOR,
    );
    return { success: true, schedule: created, warnings: validation.warnings };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function updateSchedule(id: string, update: ScheduleUpdate): Promise<ScheduleMutationResult> {
  await ensurePermission('all');
  try {
    const existing = await prisma.backup_schedules.findUnique({ where: { id } });
    if (existing === null) return { success: false, error: `Schedule not found: ${id}` };
    const validation = validateScheduleInput({
      name: update.name ?? existing.name,
      tables: update.tables ?? existing.tables,
      intervalMins: update.intervalMins ?? existing.intervalMins,
    });
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
    return { success: true, schedule: saved, warnings: validation.warnings };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function toggleSchedule(id: string): Promise<ScheduleMutationResult> {
  await ensurePermission('all');
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
    return { success: true, schedule: saved };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function deleteSchedule(id: string): Promise<ScheduleMutationResult> {
  await ensurePermission('all');
  try {
    const existing = await prisma.backup_schedules.findUnique({ where: { id } });
    if (existing === null) return { success: false, error: `Schedule not found: ${id}` };
    await prisma.backup_schedules.delete({ where: { id } });
    await logToDiscord('Backup Schedule Deleted', `Admin deleted backup schedule **${existing.name}**.`, BACKUP_LOG_COLOR);
    return { success: true, message: `Deleted schedule ${existing.name}.` };
  } catch (error) {
    return { success: false, error: describeFailure(error) };
  }
}

export async function listRuns(limit: number = DEFAULT_RUN_LIMIT): Promise<RunListResult> {
  await ensurePermission('all');
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
