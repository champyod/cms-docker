/**
 * Backup-schedule poller entry point, run as its own long-lived service.
 *
 * Every side effect lives here: the Prisma reads and writes behind
 * `SchedulerStore`, the `docker exec` behind `ScheduleLauncher`, and the Discord
 * alert. The order they happen in is `./tick`, which takes those two ports as
 * arguments, so a schedule that is due, allowed to fire and safe to hand to
 * `pg_dump` is decided by code the tests can drive without a database, a socket
 * or a clock.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { logToDiscord } from '@/lib/discord-notifier';
import { resolveWriteRoot } from '@/lib/backup-locations';
import { prisma } from '@/lib/prisma';
import {
  buildDueScheduleFilter,
  buildStartedRun,
  buildStaleRunFilter,
  buildUnfinishedRunFilter,
  fireDueSchedules,
  reconcileStaleRuns,
  RUN_STATUS_SETTLED,
} from '@/scheduler/tick';
import type { ScheduleLauncher, SchedulerDeps, SchedulerStore } from '@/scheduler/tick';

const execFileAsync = promisify(execFile);

const TICK_INTERVAL_MS = 60_000;
const LAUNCH_TIMEOUT_MS = 30_000;
const LAUNCH_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Same red the backup-channel embeds use in actions/backups.ts and actions/schedules.ts. */
const BACKUP_LOG_COLOR = 16_711_680;

const store: SchedulerStore = {
  findDueSchedules: async (now) => prisma.backup_schedules.findMany({ where: buildDueScheduleFilter(now) }),
  findStaleRunIds: async (now) => {
    const stale = await prisma.backup_runs.findMany({ where: buildStaleRunFilter(now), select: { id: true } });
    return stale.map((row) => row.id);
  },
  findUnfinishedRunId: async (scheduleId) => {
    const unfinished = await prisma.backup_runs.findFirst({ where: buildUnfinishedRunFilter(scheduleId), select: { id: true } });
    return unfinished?.id ?? null;
  },
  createStartedRun: async (record) => {
    const run = await prisma.backup_runs.create({ data: { ...buildStartedRun(record), message: record.message } });
    return run.id;
  },
  advanceSchedule: async (schedule, cadence) => {
    await prisma.backup_schedules.update({
      where: { id: schedule.id },
      data: { lastRunAt: cadence.lastRunAt, nextRunAt: cadence.nextRunAt },
    });
  },
  updateRun: async (runId, outcome) => {
    await prisma.backup_runs.update({
      where: { id: runId },
      data: { status: outcome.status, message: outcome.message, finishedAt: outcome.finishedAt },
    });
  },
  settleRun: async (runId, message) => {
    await prisma.backup_runs.update({
      where: { id: runId },
      data: { status: RUN_STATUS_SETTLED, finishedAt: new Date(), message },
    });
  },
};

const launcher: ScheduleLauncher = {
  launch: async (args) => {
    await execFileAsync('docker', [...args], { timeout: LAUNCH_TIMEOUT_MS, maxBuffer: LAUNCH_MAX_OUTPUT_BYTES });
  },
  alert: async (title, body) => {
    await logToDiscord(title, body, BACKUP_LOG_COLOR);
  },
};

let isTicking = false;
let isStopping = false;

const deps: SchedulerDeps = { store, launcher, resolveWriteRoot, shouldStop: () => isStopping };

async function runDueSchedules(now: Date): Promise<void> {
  await fireDueSchedules(await store.findDueSchedules(now), now, deps);
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
  void reconcileStaleRuns(new Date(), deps).catch((error: unknown) => {
    console.error('Scheduler boot reconciliation failed:', error);
  });
  void runTick().catch((error: unknown) => {
    console.error('Scheduler tick failed:', error);
  });
}