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
  RUN_STATUS_SETTLED,
  RUN_STATUS_STARTED,
  UNFINISHED_RUN_STATUSES,
  buildBackupArgv,
  buildDueScheduleFilter,
  buildStartedRun,
  buildStaleRunFilter,
  buildUnfinishedRunFilter,
  computeCadence,
  describeExecFailure,
  failedRunNote,
  fireDueSchedules,
  fireSchedule,
  launchedRunNote,
  reconcileStaleRuns,
  reconciledRunNote,
  selectDueSchedules,
  selectionNeedsLargeObjects,
  settledRunNote,
  startedRunNote,
} from '@/scheduler/tick';
import type {
  DueScheduleRow,
  RunOutcome,
  ScheduleCadence,
  ScheduleLauncher,
  SchedulerDeps,
  SchedulerStore,
  StartedRunRecord,
} from '@/scheduler/tick';

const REFERENCE = new Date('2026-03-01T12:00:00.000Z');
const MINUTE_MS = 60_000;

const RUNNER_SOURCE = readFileSync(fileURLToPath(new URL('../src/scheduler/runner.ts', import.meta.url)), 'utf8');
const MAIN_SOURCE = readFileSync(fileURLToPath(new URL('../src/scheduler/main.ts', import.meta.url)), 'utf8');
const BOOTSTRAP_SOURCE = readFileSync(fileURLToPath(new URL('../src/scheduler/bootstrap.mjs', import.meta.url)), 'utf8');
const BACKUPS_ACTION_SOURCE = readFileSync(fileURLToPath(new URL('../src/app/actions/backups.ts', import.meta.url)), 'utf8');
const SCHEDULER_DOCKERFILE = readFileSync(fileURLToPath(new URL('../../docker/scheduler/Dockerfile', import.meta.url)), 'utf8');
const COMPOSE_SOURCE = readFileSync(fileURLToPath(new URL('../../docker-compose.yml', import.meta.url)), 'utf8');
const WORKFLOW_SOURCE = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');

function composeService(name: string): string {
  const start = COMPOSE_SOURCE.indexOf(`\n  ${name}:\n`);
  if (start === -1) throw new Error(`docker-compose.yml has no ${name} service`);
  const block = COMPOSE_SOURCE.slice(start + 1);
  const end = block.indexOf('\n# ===');
  return end === -1 ? block : block.slice(0, end);
}

function schedule(overrides: Partial<DueScheduleRow> = {}): DueScheduleRow {
  return { id: 'sch_1', name: 'nightly', tables: ['contests', 'users'], intervalMins: 60, enabled: true, nextRunAt: REFERENCE, locationId: null, ...overrides };
}

function at(minutesFromReference: number): Date {
  return new Date(REFERENCE.getTime() + minutesFromReference * MINUTE_MS);
}

type MutableRow = { -readonly [Key in keyof DueScheduleRow]: DueScheduleRow[Key] };

/** A stored row the fake store can advance, the way Prisma would on the real one. */
function mutableSchedule(overrides: Partial<DueScheduleRow> = {}): MutableRow {
  const base = schedule(overrides);
  return { id: base.id, name: base.name, tables: base.tables, intervalMins: base.intervalMins, enabled: base.enabled, nextRunAt: base.nextRunAt, locationId: base.locationId };
}

interface Alert {
  readonly title: string;
  readonly body: string;
}

interface FakeOptions {
  readonly unfinishedRunId?: string;
  readonly staleRunIds?: readonly string[];
  readonly launchError?: Error;
  readonly stopped?: boolean;
  /** Overrides what the location port resolves; defaults to "no --root flag". */
  readonly writeRoot?: { readonly ok: true; readonly root: string | null } | { readonly ok: false; readonly error: string };
}

interface FakeStore extends SchedulerStore {
  rows: MutableRow[];
  readonly created: StartedRunRecord[];
  readonly cadences: ReadonlyArray<{ scheduleId: string; cadence: ScheduleCadence }>;
  readonly outcomes: ReadonlyArray<{ runId: string; outcome: RunOutcome }>;
  readonly settled: Map<string, string>;
}

function fakeStore(options: FakeOptions, calls: string[]): FakeStore {
  const rows: MutableRow[] = [];
  const created: StartedRunRecord[] = [];
  const cadences: Array<{ scheduleId: string; cadence: ScheduleCadence }> = [];
  const outcomes: Array<{ runId: string; outcome: RunOutcome }> = [];
  const settled = new Map<string, string>();
  const unfinishedRunId = options.unfinishedRunId ?? null;
  let runCount = 0;
  return {
    rows,
    created,
    cadences,
    outcomes,
    settled,
    findDueSchedules: async () => {
      calls.push('findDueSchedules');
      return rows;
    },
    findStaleRunIds: async () => {
      calls.push('findStaleRunIds');
      return options.staleRunIds ?? [];
    },
    findUnfinishedRunId: async (scheduleId) => {
      calls.push(`findUnfinishedRunId:${scheduleId}`);
      return unfinishedRunId;
    },
    createStartedRun: async (record) => {
      calls.push(`createStartedRun:${record.scheduleId}`);
      created.push(record);
      runCount += 1;
      return `run_${runCount}`;
    },
    advanceSchedule: async (row, cadence) => {
      calls.push(`advanceSchedule:${row.id}`);
      cadences.push({ scheduleId: row.id, cadence });
      const stored = rows.find((entry) => entry.id === row.id);
      if (stored !== undefined) stored.nextRunAt = cadence.nextRunAt;
    },
    updateRun: async (runId, outcome) => {
      calls.push(`updateRun:${outcome.status}`);
      outcomes.push({ runId, outcome });
    },
    settleRun: async (runId, message) => {
      calls.push(`settleRun:${runId}`);
      settled.set(runId, message);
    },
  };
}

interface FakeLauncher extends ScheduleLauncher {
  readonly launched: string[][];
  readonly alerts: Alert[];
}

function fakeLauncher(options: FakeOptions, calls: string[]): FakeLauncher {
  const launched: string[][] = [];
  const alerts: Alert[] = [];
  return {
    launched,
    alerts,
    launch: async (args) => {
      calls.push('launch');
      launched.push([...args]);
      if (options.launchError !== undefined) throw options.launchError;
    },
    alert: async (title, body) => {
      calls.push(`alert:${title}`);
      alerts.push({ title, body });
    },
  };
}

function fakeDeps(options: FakeOptions = {}): {
  readonly calls: string[];
  readonly store: FakeStore;
  readonly launcher: FakeLauncher;
  readonly deps: SchedulerDeps;
} {
  const calls: string[] = [];
  const store = fakeStore(options, calls);
  const launcher = fakeLauncher(options, calls);
  return {
    calls,
    store,
    launcher,
    deps: {
      store,
      launcher,
      resolveWriteRoot: () => options.writeRoot ?? { ok: true, root: null },
      shouldStop: () => options.stopped === true,
    },
  };
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

  it('never treats a settled row as unfinished, so settling releases its schedule', () => {
    const { status } = buildUnfinishedRunFilter('sch_1');
    expect(status.in).not.toContain(RUN_STATUS_SETTLED);
  });
});

describe('buildStaleRunFilter', () => {
  it('asks for started rows older than a day, which no live launch can own', () => {
    expect(buildStaleRunFilter(REFERENCE)).toEqual({ status: RUN_STATUS_STARTED, startedAt: { lte: new Date('2026-02-28T12:00:00.000Z') } });
  });

  it('never selects a row this scheduler already resolved or an operator settled', () => {
    expect(buildStaleRunFilter(REFERENCE).status).not.toBe(RUN_STATUS_LAUNCHED);
    expect(buildStaleRunFilter(REFERENCE).status).not.toBe(RUN_STATUS_FAILED);
    expect(buildStaleRunFilter(REFERENCE).status).not.toBe(RUN_STATUS_SETTLED);
  });
});

describe('computeCadence', () => {
  it('moves the due time one interval past the tick instant, not past the last due time', () => {
    expect(computeCadence(schedule({ intervalMins: 60 }), REFERENCE)).toEqual({ lastRunAt: REFERENCE, nextRunAt: computeNextRun(REFERENCE, 60) });
    expect(computeCadence(schedule({ intervalMins: 15 }), REFERENCE).nextRunAt).toEqual(at(15));
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
    const result = buildBackupArgv(['contests', 'monitor_targets']);
    expect(result.valid).toBe(false);
    expect(result.args).toEqual([]);
    expect(result.tables).toEqual([]);
    expect(result.error).toBe('Not in the backup table catalog: monitor_targets');
  });

  it('rejects a name that could smuggle a shell metacharacter through', () => {
    const result = buildBackupArgv(['contests; rm -rf /']);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('contests; rm -rf /');
  });

  it('rejects a selection that is not a list of names', () => {
    expect(buildBackupArgv([42] as unknown as string[]).error).toBe('Table selection must be a list of names.');
  });

  it('rejects a non-array selection', () => {
    expect(buildBackupArgv('contests' as unknown as string[]).error).toBe('Table selection must be a list of names.');
  });

  it('never leaves an error null on a rejected selection', () => {
    expect(buildBackupArgv(['contests', 'monitor_targets']).error).not.toBeNull();
    expect(buildBackupArgv(['nope']).error).not.toBeNull();
  });

  it('appends --root for a non-default write root', () => {
    const result = buildBackupArgv(['contests'], '/mnt/offsite/cms-backups');
    expect(result.valid).toBe(true);
    expect(result.args).toContain('--root');
    expect(result.args.at(-1)).toBe('/mnt/offsite/cms-backups');
  });

  it('omits --root when the write root is null, keeping the monitor default', () => {
    expect(buildBackupArgv(['contests'], null).args).not.toContain('--root');
  });

  it('rejects a relative write root that would resolve against the monitor cwd', () => {
    const result = buildBackupArgv(['contests'], './backups');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('absolute path');
  });
});

describe('a schedule that names no table backs up every table', () => {
  it('resolves an empty selection to the whole catalog instead of refusing it', () => {
    const result = buildBackupArgv([]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.tables).toEqual([...BACKUP_TABLE_NAMES]);
  });

  it('hands pg_dump an explicit --tables list naming every table, never an empty one', () => {
    const result = buildBackupArgv([]);
    expect(result.args).toEqual([
      'exec',
      '-d',
      MONITOR_CONTAINER,
      'bash',
      MONITOR_BACKUP_SCRIPT,
      '--tables',
      BACKUP_TABLE_NAMES.join(','),
      '--large-objects',
    ]);
  });

  it('takes the all-tables selection through the same catalog ordering as an explicit one', () => {
    expect(buildBackupArgv([]).tables).toEqual(buildBackupArgv([...BACKUP_TABLE_NAMES]).tables);
  });

  it('adds --large-objects, because the catalog holds fsobjects and its digest consumers', () => {
    const result = buildBackupArgv([]);
    expect(result.args).toContain('--large-objects');
    expect(selectionNeedsLargeObjects(result.tables)).toBe(true);
  });

  it('still dumps exactly an explicit subset, unchanged', () => {
    const result = buildBackupArgv(['users', 'contests']);
    expect(result.valid).toBe(true);
    expect(result.tables).toEqual(['contests', 'users']);
    expect(result.args).toContain('contests,users');
  });

  it('still rejects an explicitly named table outside the catalog', () => {
    const result = buildBackupArgv(['contests', 'monitor_targets']);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Not in the backup table catalog: monitor_targets');
  });

  it('does not let the default excuse a name that smuggled in alongside nothing else', () => {
    expect(buildBackupArgv(['; rm -rf /']).valid).toBe(false);
  });

  it('refuses a non-list selection instead of reading its length as an absent one', () => {
    expect(buildBackupArgv('contests' as unknown as string[]).valid).toBe(false);
    expect(buildBackupArgv({ length: 0 } as unknown as string[]).valid).toBe(false);
  });
});

describe('fireSchedule location handling', () => {
  it('rejects an unknown location id instead of redirecting to the default tree', async () => {
    const { launcher, deps } = fakeDeps({ writeRoot: { ok: false, error: 'Unknown backup location: ghost' } });
    await fireSchedule(schedule({ locationId: 'ghost' }), REFERENCE, deps);
    expect(launcher.launched).toEqual([]);
    expect(launcher.alerts).toEqual([
      { title: 'Scheduled Backup Rejected', body: 'Schedule **nightly** was skipped: Unknown backup location: ghost It will be retried on its own interval until its configuration is fixed.' },
    ]);
  });

  it('hands the resolved root to the launcher through the argv', async () => {
    const { launcher, deps } = fakeDeps({ writeRoot: { ok: true, root: '/mnt/offsite/cms-backups' } });
    await fireSchedule(schedule({ locationId: 'secondary' }), REFERENCE, deps);
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0]).toContain('--root');
    expect(launcher.launched[0]?.at(-1)).toBe('/mnt/offsite/cms-backups');
  });

  it('launches with no --root when the root resolves to null', async () => {
    const { launcher, deps } = fakeDeps({ writeRoot: { ok: true, root: null } });
    await fireSchedule(schedule({ locationId: null }), REFERENCE, deps);
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0]).not.toContain('--root');
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

  it('says the row was settled by hand without claiming the backup succeeded', () => {
    const note = settledRunNote();
    expect(note).toContain('Settled by an operator');
    expect(note).not.toContain('succeeded');
    expect(note).toContain('backups/manifest.json');
  });

  it('keeps the operator note when one is given, and drops a blank one', () => {
    expect(settledRunNote('  verified against manifest.json  ')).toContain('verified against manifest.json');
    expect(settledRunNote('   ')).toBe(settledRunNote());
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

describe('fireSchedule on a launch', () => {
  it('checks the overlap guard before it claims a run or touches the cadence', async () => {
    const { calls, store, launcher, deps } = fakeDeps({ unfinishedRunId: 'run_stuck' });
    await fireSchedule(schedule(), REFERENCE, deps);
    expect(calls).toEqual(['findUnfinishedRunId:sch_1']);
    expect(store.created).toEqual([]);
    expect(store.cadences).toEqual([]);
    expect(launcher.launched).toEqual([]);
    expect(store.outcomes).toEqual([]);
  });

  it('claims the run and advances the cadence before it execs docker', async () => {
    const { calls, deps } = fakeDeps();
    await fireSchedule(schedule(), REFERENCE, deps);
    expect(calls).toEqual([
      'findUnfinishedRunId:sch_1',
      'createStartedRun:sch_1',
      'advanceSchedule:sch_1',
      'launch',
      'updateRun:launched',
      'alert:Scheduled Backup Launched',
    ]);
  });

  it('writes the never-observed note on the started row, so a launch lost mid-flight is self-describing', async () => {
    const { store, deps } = fakeDeps();
    await fireSchedule(schedule(), REFERENCE, deps);
    expect(store.created).toEqual([{ scheduleId: 'sch_1', tables: ['contests', 'users'], startedAt: REFERENCE, message: startedRunNote() }]);
  });

  it('advances the cadence from the tick instant, on the schedule own interval', async () => {
    const { store, deps } = fakeDeps();
    await fireSchedule(schedule({ intervalMins: 30 }), REFERENCE, deps);
    expect(store.cadences).toEqual([{ scheduleId: 'sch_1', cadence: { lastRunAt: REFERENCE, nextRunAt: at(30) } }]);
  });

  it('settles the launched run without claiming a result it cannot see', async () => {
    const { store, deps } = fakeDeps();
    await fireSchedule(schedule(), REFERENCE, deps);
    expect(store.outcomes).toEqual([
      { runId: 'run_1', outcome: { status: RUN_STATUS_LAUNCHED, message: launchedRunNote('nightly', 2), finishedAt: null } },
    ]);
  });

  it('fails the run at the tick instant and alerts Discord when the exec itself fails', async () => {
    const launchError = Object.assign(new Error('Command failed: docker exec'), { stderr: 'Error: No such container: cms-monitor\n' });
    const { store, launcher, deps } = fakeDeps({ launchError });
    await fireSchedule(schedule(), REFERENCE, deps);
    expect(store.outcomes).toEqual([
      { runId: 'run_1', outcome: { status: RUN_STATUS_FAILED, message: failedRunNote('Command failed: docker exec: Error: No such container: cms-monitor'), finishedAt: REFERENCE } },
    ]);
    expect(launcher.alerts).toEqual([
      { title: 'Scheduled Backup Failed', body: 'Schedule **nightly** could not start its dump: Command failed: docker exec: Error: No such container: cms-monitor' },
    ]);
  });
});

describe('fireSchedule on a selection that left the catalog', () => {
  const LEFT_THE_CATALOG = schedule({ tables: ['contests', 'monitor_targets'] });

  it('advances the cadence on the schedule interval instead of leaving it due-past', async () => {
    const { calls, store, deps } = fakeDeps();
    await fireSchedule(LEFT_THE_CATALOG, REFERENCE, deps);
    expect(store.cadences).toEqual([{ scheduleId: 'sch_1', cadence: { lastRunAt: REFERENCE, nextRunAt: at(60) } }]);
    expect(calls).toEqual(['advanceSchedule:sch_1', 'alert:Scheduled Backup Rejected']);
  });

  it('claims no run and execs nothing, because there is no argv to hand over', async () => {
    const { store, launcher, deps } = fakeDeps();
    await fireSchedule(LEFT_THE_CATALOG, REFERENCE, deps);
    expect(store.created).toEqual([]);
    expect(store.outcomes).toEqual([]);
    expect(launcher.launched).toEqual([]);
  });

  it('alerts once per rejection and names the table that left the catalog', async () => {
    const { launcher, deps } = fakeDeps();
    await fireSchedule(LEFT_THE_CATALOG, REFERENCE, deps);
    expect(launcher.alerts).toEqual([
      { title: 'Scheduled Backup Rejected', body: 'Schedule **nightly** was skipped: Not in the backup table catalog: monitor_targets It will be retried on its own interval until its configuration is fixed.' },
    ]);
  });

  it('retries on cadence, not on every tick, and launches once the selection is fixed', async () => {
    const row = mutableSchedule({ tables: ['contests', 'monitor_targets'] });
    const { store, launcher, deps } = fakeDeps();
    store.rows.push(row);
    await fireDueSchedules(store.rows, REFERENCE, deps);
    await fireDueSchedules(store.rows, at(30), deps);
    expect(launcher.alerts.map((alert) => alert.title)).toEqual(['Scheduled Backup Rejected']);
    expect(row.nextRunAt).toEqual(at(60));
    row.tables = ['contests'];
    await fireDueSchedules(store.rows, at(60), deps);
    expect(launcher.launched).toEqual([['exec', '-d', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', 'contests']]);
    expect(launcher.alerts.map((alert) => alert.title)).toEqual(['Scheduled Backup Rejected', 'Scheduled Backup Launched']);
  });
});

describe('fireSchedule on a schedule that names no table', () => {
  const NO_SELECTION = schedule({ tables: [] });

  it('launches a dump of the whole catalog instead of rejecting the row', async () => {
    const { launcher, deps } = fakeDeps();
    await fireSchedule(NO_SELECTION, REFERENCE, deps);
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0]).toContain(BACKUP_TABLE_NAMES.join(','));
    expect(launcher.alerts.map((alert) => alert.title)).toEqual(['Scheduled Backup Launched']);
  });

  it('records the resolved table list on the run, so history shows what was dumped', async () => {
    const { store, deps } = fakeDeps();
    await fireSchedule(NO_SELECTION, REFERENCE, deps);
    expect(store.created).toEqual([{ scheduleId: 'sch_1', tables: [...BACKUP_TABLE_NAMES], startedAt: REFERENCE, message: startedRunNote() }]);
  });

  it('reports the resolved table count, not zero, in the run note and the alert', async () => {
    const { store, launcher, deps } = fakeDeps();
    await fireSchedule(NO_SELECTION, REFERENCE, deps);
    expect(store.outcomes.map((entry) => entry.outcome.message)).toEqual([launchedRunNote('nightly', BACKUP_TABLE_NAMES.length)]);
    expect(launcher.alerts[0]?.body).toContain(`${BACKUP_TABLE_NAMES.length} table(s)`);
  });
});

describe('fireDueSchedules', () => {
  it('reads the candidates once and fires only the rows that are still due', async () => {
    const { calls, store, launcher, deps } = fakeDeps();
    store.rows.push(schedule({ id: 'sch_due', nextRunAt: at(-1) }), schedule({ id: 'sch_later', nextRunAt: at(10) }));
    await fireDueSchedules(store.rows, REFERENCE, deps);
    expect(calls.filter((call) => call.startsWith('advanceSchedule'))).toEqual(['advanceSchedule:sch_due']);
    expect(launcher.launched).toHaveLength(1);
  });

  it('fires nothing once shutdown has started', async () => {
    const { calls, store, deps } = fakeDeps({ stopped: true });
    store.rows.push(schedule({ nextRunAt: at(-1) }));
    await fireDueSchedules(store.rows, REFERENCE, deps);
    expect(calls).toEqual([]);
  });
});

describe('reconcileStaleRuns', () => {
  it('settles a started row a dead scheduler left, which is what releases its schedule', async () => {
    const { calls, store, deps } = fakeDeps({ staleRunIds: ['run_stale'] });
    expect(await reconcileStaleRuns(REFERENCE, deps)).toBe(1);
    expect(store.settled.get('run_stale')).toBe(reconciledRunNote());
    expect(calls).toEqual(['findStaleRunIds', 'settleRun:run_stale', 'alert:Backup Runs Reconciled']);
  });

  it('says in the note that boot settled the row, so history stays readable', async () => {
    expect(reconciledRunNote()).toContain('reconciled on boot');
  });

  it('alerts once with the count, because a settled row claims nothing about the dump', async () => {
    const { launcher, deps } = fakeDeps({ staleRunIds: ['run_a', 'run_b'] });
    expect(await reconcileStaleRuns(REFERENCE, deps)).toBe(2);
    expect(launcher.alerts).toEqual([
      { title: 'Backup Runs Reconciled', body: '2 run(s) were left unfinished by an earlier scheduler process and have been settled on boot; their real results are in Discord and backups/manifest.json.' },
    ]);
  });

  it('writes nothing and stays silent when no run is stale', async () => {
    const { store, launcher, deps } = fakeDeps();
    expect(await reconcileStaleRuns(REFERENCE, deps)).toBe(0);
    expect(store.settled.size).toBe(0);
    expect(launcher.alerts).toEqual([]);
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

  it('refuses to overlap a tick with itself', () => {
    expect(RUNNER_SOURCE).toContain('if (isTicking) return;');
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

describe('scheduler image', () => {
  it('builds in a stage that installs dependencies and generates the Prisma client', () => {
    expect(SCHEDULER_DOCKERFILE).toContain('RUN pnpm install --no-frozen-lockfile');
    expect(SCHEDULER_DOCKERFILE).toContain('RUN pnpm prisma generate --schema=./prisma/schema.prisma');
  });

  it('compiles the poller with the project TypeScript, not a bundler or a type stripper', () => {
    expect(SCHEDULER_DOCKERFILE).toContain('RUN pnpm exec tsc -p src/scheduler/tsconfig.build.json');
  });

  it('ships the compiled output, the Prisma client and the Docker CLI', () => {
    expect(SCHEDULER_DOCKERFILE).toContain('COPY --from=build /app/dist ./dist');
    expect(SCHEDULER_DOCKERFILE).toContain('COPY --from=build /app/node_modules ./node_modules');
    expect(SCHEDULER_DOCKERFILE).toContain('curl -fsSL https://get.docker.com | sh');
  });

  it('never bakes in the socket, only mounts it at run time', () => {
    expect(SCHEDULER_DOCKERFILE).not.toContain('docker.sock');
  });

  it('runs unprivileged, like cms-monitor', () => {
    expect(SCHEDULER_DOCKERFILE).toContain('USER node');
  });

  it('starts the compiled entry through the alias bootstrap', () => {
    expect(SCHEDULER_DOCKERFILE).toContain('CMD ["node", "bootstrap.mjs"]');
  });
});

describe('scheduler process entry', () => {
  it('is the only module that starts the polling loop', () => {
    expect(MAIN_SOURCE).toContain("import { startScheduler } from '@/scheduler/runner'");
    expect(MAIN_SOURCE).toContain('startScheduler();');
    expect(RUNNER_SOURCE).not.toContain('startScheduler();');
  });

  it('resolves the emitted path alias before the first load', () => {
    expect(BOOTSTRAP_SOURCE).toContain("request.startsWith('@/')");
    expect(BOOTSTRAP_SOURCE).toContain("loadCompiled(path.join(DIST_ROOT, 'scheduler', 'main.js'))");
  });

  it('reaches the compiled CommonJS tree through createRequire, not a bare require', () => {
    expect(BOOTSTRAP_SOURCE).toContain('createRequire(import.meta.url)');
    expect(BOOTSTRAP_SOURCE).not.toMatch(/(^|[^.\w])require\(/);
  });
});

describe('scheduler compose service', () => {
  const service = composeService('scheduler');

  it('is named cms-scheduler and restarts like its siblings', () => {
    expect(service).toContain('container_name: cms-scheduler');
    expect(service).toContain('restart: unless-stopped');
  });

  it('joins the monitor profile, so make infra and make all start it', () => {
    expect(service).toContain('profiles:\n      - monitor');
  });

  it('mounts the Docker socket read-write, because docker exec writes to it', () => {
    expect(service).toContain('- /var/run/docker.sock:/var/run/docker.sock\n');
    expect(service).not.toContain('/var/run/docker.sock:ro');
  });

  it('takes the docker group GID, because the socket is not world-writable', () => {
    expect(service).toContain('group_add:\n      - "${DOCKER_GID:-999}"');
  });

  it('waits for a healthy database instead of failing its first tick', () => {
    expect(service).toContain('depends_on:\n      database:\n        condition: service_healthy');
  });

  it('takes its database and Discord config from the host env, never from the file', () => {
    expect(service).toContain('DATABASE_URL=postgresql://${POSTGRES_USER:-cmsuser}:${POSTGRES_PASSWORD:-cmspassword}@database:5432/${POSTGRES_DB:-cmsdb}');
    expect(service).toContain('DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}');
    expect(service).toContain('DISCORD_ROLE_ID=${DISCORD_ROLE_ID}');
  });

  it('carries the same backup rotation config the monitor container runs with', () => {
    expect(service).toContain('BACKUP_MAX_COUNT=${BACKUP_MAX_COUNT:-50}');
    expect(service).toContain('BACKUP_MAX_AGE_DAYS=${BACKUP_MAX_AGE_DAYS:-10}');
    expect(service).toContain('BACKUP_MAX_SIZE_GB=${BACKUP_MAX_SIZE_GB:-5}');
    expect(service).toContain('BACKUP_INTERVAL_MINS=${BACKUP_INTERVAL_MINS:-1440}');
  });

  it('publishes under the sibling image naming scheme', () => {
    expect(service).toContain('image: ghcr.io/champyod/cms-docker-scheduler:${IMG_TAG:-major-admin-panel}');
  });

  it('builds from docker/scheduler/Dockerfile without touching the admin or monitor image', () => {
    expect(service).toContain('dockerfile: docker/scheduler/Dockerfile');
    expect(service).not.toContain('admin-panel/Dockerfile');
    expect(service).not.toContain('docker/monitor/Dockerfile');
  });
});

describe('scheduler publish workflow', () => {
  it('rebuilds on the paths the scheduler image is built from', () => {
    expect(WORKFLOW_SOURCE).toContain('scheduler: ${{ steps.filter.outputs.scheduler }}');
    expect(WORKFLOW_SOURCE).toContain("- 'admin-panel/src/scheduler/**'");
    expect(WORKFLOW_SOURCE).toContain("- 'docker/scheduler/**'");
  });

  it('publishes a scheduler image with the same registry, tags and cache scope pattern', () => {
    expect(WORKFLOW_SOURCE).toContain('needs.changes.outputs.scheduler == \'true\'');
    expect(WORKFLOW_SOURCE).toContain('images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-scheduler');
    expect(WORKFLOW_SOURCE).toContain('file: ./docker/scheduler/Dockerfile');
    expect(WORKFLOW_SOURCE).toContain('cache-from: type=gha,scope=scheduler');
    expect(WORKFLOW_SOURCE).toContain("type=raw,value=latest,enable=${{ github.ref_name == 'main' || github.ref_name == 'major/admin-panel' }}");
  });

  it('pushes only outside pull requests, like every sibling image', () => {
    const job = WORKFLOW_SOURCE.slice(WORKFLOW_SOURCE.indexOf('build-and-push-scheduler:'));
    expect(job).toContain("push: ${{ github.event_name != 'pull_request' }}");
    expect(job).toContain("if: github.event_name != 'pull_request'");
    expect(job).toContain('packages: write');
  });
});
