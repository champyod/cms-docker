/**
 * Backup-schedule poller entry point, run as its own long-lived service.
 *
 * It owns the only side effects in the scheduler: the Prisma reads and writes,
 * the `docker exec` that hands a dump to cms-monitor, and the Discord alert. The
 * decisions it makes come from `./tick`, so a schedule that is due, allowed to
 * fire, and safe to hand to `pg_dump` is decided by code the tests can reach
 * without a database, a socket or a clock.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { computeNextRun } from '@/lib/backup-schedules';
import { logToDiscord } from '@/lib/discord-notifier';
import { prisma } from '@/lib/prisma';
import {
  buildBackupArgv,
  buildDueScheduleFilter,
  buildStartedRun,
  buildUnfinishedRunFilter,
  describeExecFailure,
  failedRunNote,
  launchedRunNote,
  selectDueSchedules,
  startedRunNote,
  RUN_STATUS_FAILED,
  RUN_STATUS_LAUNCHED,
} from '@/scheduler/tick';
import type { BackupArgvResult, DueScheduleRow } from '@/scheduler/tick';

const execFileAsync = promisify(execFile);

const TICK_INTERVAL_MS = 60_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const LAUNCH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Same red the backup-channel embeds use in actions/backups.ts and actions/schedules.ts. */
const BACKUP_LOG_COLOR = 16_711_680;

let isTicking = false;
let isStopping = false;

async function hasUnfinishedRun(scheduleId: string): Promise<boolean> {
  const unfinished = await prisma.backup_runs.findFirst({
    where: buildUnfinishedRunFilter(scheduleId),
    select: { id: true },
  });
  return unfinished !== null;
}

async function recordStartedRun(scheduleId: string, tables: readonly string[], now: Date): Promise<string> {
  const run = await prisma.backup_runs.create({
    data: { ...buildStartedRun({ scheduleId, tables, startedAt: now }), message: startedRunNote() },
  });
  return run.id;
}

/**
 * Advances the cadence even when the launch fails, so a broken schedule retries
 * on its own interval instead of firing on every tick for as long as it is due.
 */
async function advanceSchedule(schedule: DueScheduleRow, now: Date): Promise<void> {
  await prisma.backup_schedules.update({
    where: { id: schedule.id },
    data: { lastRunAt: now, nextRunAt: computeNextRun(now, schedule.intervalMins) },
  });
}

async function reportLaunchFailure(schedule: DueScheduleRow, runId: string, error: unknown): Promise<void> {
  const reason = describeExecFailure(error);
  await prisma.backup_runs.update({
    where: { id: runId },
    data: { status: RUN_STATUS_FAILED, finishedAt: new Date(), message: failedRunNote(reason) },
  });
  await logToDiscord('Scheduled Backup Failed', `Schedule **${schedule.name}** could not start its dump: ${reason}`, BACKUP_LOG_COLOR);
}

async function reportLaunch(schedule: DueScheduleRow, runId: string, tableCount: number): Promise<void> {
  await prisma.backup_runs.update({
    where: { id: runId },
    data: { status: RUN_STATUS_LAUNCHED, message: launchedRunNote(schedule.name, tableCount) },
  });
  await logToDiscord(
    'Scheduled Backup Launched',
    `Schedule **${schedule.name}** handed a detached dump of ${tableCount} table(s) to cms-monitor. Follow this channel for the result.`,
    BACKUP_LOG_COLOR,
  );
}

async function launchRun(schedule: DueScheduleRow, args: readonly string[], tableCount: number, runId: string): Promise<void> {
  try {
    await execFileAsync('docker', [...args], { timeout: LAUNCH_TIMEOUT_MS, maxBuffer: LAUNCH_MAX_OUTPUT_BYTES });
    await reportLaunch(schedule, runId, tableCount);
  } catch (error) {
    await reportLaunchFailure(schedule, runId, error);
  }
}

async function launchSchedule(schedule: DueScheduleRow, argv: BackupArgvResult, now: Date): Promise<void> {
  const runId = await recordStartedRun(schedule.id, argv.tables, now);
  await advanceSchedule(schedule, now);
  await launchRun(schedule, argv.args, argv.tables.length, runId);
}

async function fireSchedule(schedule: DueScheduleRow, now: Date): Promise<void> {
  const argv = buildBackupArgv(schedule.tables);
  if (!argv.valid) {
    await logToDiscord('Scheduled Backup Rejected', `Schedule **${schedule.name}** was skipped: ${argv.error}`, BACKUP_LOG_COLOR);
    return;
  }
  if (await hasUnfinishedRun(schedule.id)) return;
  await launchSchedule(schedule, argv, now);
}

async function runDueSchedules(now: Date): Promise<void> {
  const candidates = await prisma.backup_schedules.findMany({ where: buildDueScheduleFilter(now) });
  for (const schedule of selectDueSchedules(candidates, now)) {
    if (isStopping) return;
    await fireSchedule(schedule, now);
  }
}

export async function runTick(now: Date = new Date()): Promise<void> {
  if (isTicking) return;
  isTicking = true;
  try {
    await runDueSchedules(now);
  } finally {
    isTicking = false;
  }
}

function startPolling(): NodeJS.Timeout {
  return setInterval(() => {
    void runTick().catch((error: unknown) => {
      console.error('Scheduler tick failed:', error);
    });
  }, TICK_INTERVAL_MS);
}

function stopPolling(timer: NodeJS.Timeout, onShutdown: () => void): void {
  clearInterval(timer);
  process.off('SIGTERM', onShutdown);
  process.off('SIGINT', onShutdown);
}

export function startScheduler(): void {
  const timer = startPolling();
  const shutdown = (): void => {
    if (isStopping) return;
    isStopping = true;
    stopPolling(timer, shutdown);
    console.log('Scheduler stopping.');
    void prisma.$disconnect().finally(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log(`Scheduler polling every ${TICK_INTERVAL_MS / 1000}s.`);
  void runTick().catch((error: unknown) => {
    console.error('Scheduler tick failed:', error);
  });
}

/** Importing the module must not start the loop; only running it as the entry point may. */
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) startScheduler();
