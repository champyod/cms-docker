import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import { computeNextRun } from '@/lib/backup-schedules';
import {
  MONITOR_BACKUP_SCRIPT,
  MONITOR_CONTAINER,
  RUN_KIND,
  RUN_STATUS_FAILED,
  RUN_STATUS_LAUNCHED,
  RUN_STATUS_STARTED,
  UNFINISHED_RUN_STATUSES,
  buildBackupArgv,
  buildDueScheduleFilter,
  buildStartedRun,
  buildUnfinishedRunFilter,
  describeExecFailure,
  failedRunNote,
  launchedRunNote,
  selectDueSchedules,
  selectionNeedsLargeObjects,
  startedRunNote,
} from '@/scheduler/tick';
import type { DueScheduleRow } from '@/scheduler/tick';

const REFERENCE = new Date('2026-03-01T12:00:00.000Z');
const MINUTE_MS = 60_000;

const RUNNER_SOURCE = readFileSync(fileURLToPath(new URL('../src/scheduler/runner.ts', import.meta.url)), 'utf8');
const BACKUPS_ACTION_SOURCE = readFileSync(fileURLToPath(new URL('../src/app/actions/backups.ts', import.meta.url)), 'utf8');

function schedule(overrides: Partial<DueScheduleRow> = {}): DueScheduleRow {
  return { id: 'sch_1', name: 'nightly', tables: ['contests', 'users'], intervalMins: 60, enabled: true, nextRunAt: REFERENCE, ...overrides };
}

describe('buildDueScheduleFilter', () => {
  it('asks for exactly the indexed predicate: enabled and due', () => {
    expect(buildDueScheduleFilter(REFERENCE)).toEqual({ enabled: true, nextRunAt: { lte: REFERENCE } });
  });

  it('compares against the instant it was given, not the wall clock', () => {
    const later = new Date(REFERENCE.getTime() + 5 * MINUTE_MS);
    expect(buildDueScheduleFilter(later).nextRunAt.lte).toBe(later);
  });
});

describe('buildUnfinishedRunFilter', () => {
  it('scopes the guard to one schedule and the started status', () => {
    expect(buildUnfinishedRunFilter('sch_1')).toEqual({ scheduleId: 'sch_1', status: { in: ['started'] } });
  });

  it('never treats a failed or launched row as unfinished', () => {
    const { status } = buildUnfinishedRunFilter('sch_1');
    expect(status.in).not.toContain(RUN_STATUS_FAILED);
    expect(status.in).not.toContain(RUN_STATUS_LAUNCHED);
  });
});

describe('selectDueSchedules', () => {
  it('keeps a schedule whose due time has passed', () => {
    const due = schedule({ nextRunAt: new Date(REFERENCE.getTime() - 1) });
    expect(selectDueSchedules([due], REFERENCE)).toEqual([due]);
  });

  it('keeps a schedule due exactly now', () => {
    const exact = schedule();
    expect(selectDueSchedules([exact], REFERENCE)).toEqual([exact]);
  });

  it('drops a schedule that is not due yet', () => {
    expect(selectDueSchedules([schedule({ nextRunAt: new Date(REFERENCE.getTime() + 1) })], REFERENCE)).toEqual([]);
  });

  it('drops a disabled schedule even when it is overdue', () => {
    expect(selectDueSchedules([schedule({ enabled: false, nextRunAt: new Date(REFERENCE.getTime() - MINUTE_MS) })], REFERENCE)).toEqual([]);
  });

  it('keeps only the due rows and preserves their order', () => {
    const overdue = schedule({ id: 'a', nextRunAt: new Date(REFERENCE.getTime() - MINUTE_MS) });
    const later = schedule({ id: 'b', nextRunAt: new Date(REFERENCE.getTime() + 10 * MINUTE_MS) });
    const onTime = schedule({ id: 'c' });
    expect(selectDueSchedules([later, overdue, onTime], REFERENCE).map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('returns an empty list for no rows', () => {
    expect(selectDueSchedules([], REFERENCE)).toEqual([]);
  });
});

describe('buildBackupArgv', () => {
  it('mirrors the manual-run argv that actions/backups.ts builds', () => {
    expect(buildBackupArgv(['contests', 'users']).args).toEqual([
      'exec',
      '-d',
      'cms-monitor',
      'bash',
      '/usr/local/bin/cms-backup.sh',
      '--tables',
      'contests,users',
    ]);
  });

  it('adds --large-objects when a selected table carries large objects', () => {
    const result = buildBackupArgv(['contests', 'fsobjects']);
    expect(result.valid).toBe(true);
    expect(result.args).toEqual(['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', 'contests,fsobjects', '--large-objects']);
  });

  it('omits --large-objects for a selection without a large-object table', () => {
    expect(buildBackupArgv(['contests', 'users']).args).not.toContain('--large-objects');
  });

  it('treats a large-object consumer as needing -b, because its digests point at fsobjects', () => {
    expect(buildBackupArgv(['submissions']).args).toContain('--large-objects');
  });

  it('sorts the csv into catalog order so a selection is always dumped parent-first', () => {
    expect(buildBackupArgv(['users', 'contests']).args).toContain('contests,users');
  });

  it('keeps every catalog name it is given, in one csv', () => {
    const result = buildBackupArgv([...BACKUP_TABLE_NAMES]);
    expect(result.args).toContain(BACKUP_TABLE_NAMES.join(','));
  });

  it('rejects a table outside the catalog instead of passing it to pg_dump', () => {
    const result = buildBackupArgv(['contests', 'admins']);
    expect(result.valid).toBe(false);
    expect(result.args).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.error).toBe('Not in the backup table catalog: admins');
  });

  it('rejects a name that could smuggle a shell metacharacter through', () => {
    const result = buildBackupArgv(['contests; rm -rf /']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('contests; rm -rf /');
  });

  it('rejects an empty selection that would dump the whole database', () => {
    const result = buildBackupArgv([]);
    expect(result.valid).toBe(false);
    expect(result.args).toEqual([]);
    expect(result.error).toBe('At least one table must be selected.');
  });

  it('rejects a selection that is not a list of names', () => {
    expect(buildBackupArgv([42] as unknown as string[]).error).toBe('Table selection must be a list of names.');
  });

  it('rejects a non-array selection', () => {
    expect(buildBackupArgv('contests' as unknown as string[]).error).toBe('Table selection must be a list of names.');
  });

  it('never leaves an error null on a rejected selection', () => {
    expect(buildBackupArgv([]).error).not.toBeNull();
    expect(buildBackupArgv(['nope']).error).not.toBeNull();
  });
});

describe('selectionNeedsLargeObjects', () => {
  it('is true for fsobjects and for the tables that reference it', () => {
    expect(selectionNeedsLargeObjects(['contests', 'fsobjects'])).toBe(true);
    expect(selectionNeedsLargeObjects(['user_test_files'])).toBe(true);
  });

  it('is false for a selection with no large-object table', () => {
    expect(selectionNeedsLargeObjects(['contests', 'users', 'teams'])).toBe(false);
  });

  it('is false for an empty selection', () => {
    expect(selectionNeedsLargeObjects([])).toBe(false);
  });
});

describe('buildStartedRun', () => {
  it('records a schedule-owned run as started at the tick instant', () => {
    expect(buildStartedRun({ scheduleId: 'sch_1', tables: ['contests'], startedAt: REFERENCE })).toEqual({
      scheduleId: 'sch_1',
      kind: RUN_KIND,
      tables: ['contests'],
      status: RUN_STATUS_STARTED,
      startedAt: REFERENCE,
    });
  });

  it('copies the table list, so a later mutation cannot rewrite stored history', () => {
    const tables = ['contests'];
    const run = buildStartedRun({ scheduleId: 'sch_1', tables, startedAt: REFERENCE });
    tables.push('users');
    expect(run.tables).toEqual(['contests']);
  });

  it('starts a manual-looking run apart from a hand-triggered one', () => {
    expect(RUN_KIND).toBe('schedule');
  });
});

describe('run notes', () => {
  it('says the launch was only handed over, so no completion is implied', () => {
    const note = launchedRunNote('nightly', 3);
    expect(note).toContain('nightly');
    expect(note).toContain('3 table(s)');
    expect(note).toContain('not observed');
  });

  it('tells an operator why a started row was never resolved', () => {
    expect(startedRunNote()).toContain('never observed');
  });

  it('writes that note on the started row, so a launch lost mid-flight is self-describing', () => {
    expect(RUNNER_SOURCE).toContain('message: startedRunNote()');
  });

  it('carries the reason a launch failed', () => {
    expect(failedRunNote('docker: no such container')).toBe('Scheduler could not start the dump: docker: no such container');
  });
});

describe('describeExecFailure', () => {
  it('keeps the CLI stderr that the message alone drops', () => {
    const error = Object.assign(new Error('Command failed: docker exec'), { stderr: 'Error: No such container: cms-monitor\n' });
    expect(describeExecFailure(error)).toBe('Command failed: docker exec: Error: No such container: cms-monitor');
  });

  it('uses the message alone when there is no stderr', () => {
    expect(describeExecFailure(new Error('spawn docker ENOENT'))).toBe('spawn docker ENOENT');
  });

  it('reports a generic failure for a thrown non-error', () => {
    expect(describeExecFailure('boom')).toBe('Backup launch failed.');
  });
});

describe('poller wiring', () => {
  it('polls once a minute', () => {
    expect(RUNNER_SOURCE).toContain('const TICK_INTERVAL_MS = 60_000;');
  });

  it('launches docker through execFile, never a shell string', () => {
    expect(RUNNER_SOURCE).toContain("execFileAsync('docker'");
    expect(RUNNER_SOURCE).not.toContain('exec(');
    expect(RUNNER_SOURCE).not.toContain('execSync');
  });

  it('queries the due predicate instead of loading every schedule', () => {
    expect(RUNNER_SOURCE).toContain('prisma.backup_schedules.findMany({ where: buildDueScheduleFilter(now) })');
  });

  it('advances the cadence from the tick instant, on the same interval', () => {
    expect(computeNextRun(REFERENCE, 60).toISOString()).toBe('2026-03-01T13:00:00.000Z');
    expect(RUNNER_SOURCE).toContain('nextRunAt: computeNextRun(now, schedule.intervalMins)');
  });

  it('checks the overlap guard before it claims a run for a schedule', () => {
    expect(RUNNER_SOURCE).toContain('if (await hasUnfinishedRun(schedule.id)) return;');
  });

  it('refuses to overlap a tick with itself', () => {
    expect(RUNNER_SOURCE).toContain('if (isTicking) return;');
  });

  it('settles a launched run without claiming a result it cannot see', () => {
    expect(RUNNER_SOURCE).toContain(`status: RUN_STATUS_LAUNCHED, message: launchedRunNote(schedule.name, tableCount)`);
  });

  it('fails the run and alerts Discord when the exec itself fails', () => {
    expect(RUNNER_SOURCE).toContain('status: RUN_STATUS_FAILED');
    expect(RUNNER_SOURCE).toContain('logToDiscord(\'Scheduled Backup Failed\'');
  });

  it('starts a run even when a table left the catalog after the schedule was saved', () => {
    expect(RUNNER_SOURCE).toContain('const argv = buildBackupArgv(schedule.tables);');
  });

  it('shuts down gracefully on SIGTERM and SIGINT', () => {
    expect(RUNNER_SOURCE).toContain("process.on('SIGTERM', shutdown)");
    expect(RUNNER_SOURCE).toContain("process.on('SIGINT', shutdown)");
    expect(RUNNER_SOURCE).toContain('clearInterval(timer)');
    expect(RUNNER_SOURCE).toContain('prisma.$disconnect()');
  });

  it('releases its signal listeners so a restart cannot double-handle a signal', () => {
    expect(RUNNER_SOURCE).toContain("process.off('SIGTERM', onShutdown)");
    expect(RUNNER_SOURCE).toContain("process.off('SIGINT', onShutdown)");
  });

  it('keeps the unfinished set to a status nothing else writes', () => {
    expect(UNFINISHED_RUN_STATUSES).toEqual([RUN_STATUS_STARTED]);
  });
});

describe('argv parity with the manual backup path', () => {
  it('uses the same container, script and flags as actions/backups.ts', () => {
    const actionArgs = BACKUPS_ACTION_SOURCE.match(/const args = \[([^\]]+)\]/)?.[1] ?? '';
    expect(actionArgs).toContain("'exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables'");
    expect(BACKUPS_ACTION_SOURCE).toContain("args.push('--large-objects')");
    expect(MONITOR_CONTAINER).toBe('cms-monitor');
    expect(MONITOR_BACKUP_SCRIPT).toBe('/usr/local/bin/cms-backup.sh');
  });
});
