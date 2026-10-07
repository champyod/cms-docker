import { describe, expect, it } from 'vitest';

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import {
  ADMIN_ID_COLUMN,
  ADMIN_NULL_TABLES,
  DEFAULT_STRATEGY,
  LARGE_OBJECT_TABLE,
  LARGE_TABLE_ROW_WARN,
  PROMOTE_TOKEN_TTL_MS,
  TABLE_STRATEGIES,
  adminColumnFor,
  applyOrder,
  buildReportId,
  checkConfirmToken,
  conflictMessage,
  detectUniqueConflicts,
  fkOverwriteConflictMessage,
  fkOverwriteConflicts,
  isTableStrategy,
  normalizeStrategies,
  overwriteParentConflicts,
  parseReportId,
  planApply,
  uniqueValueConflictMessage,
} from '@/lib/restore-apply';
import type { ApplyStrategies, FkOverwriteConflict } from '@/lib/restore-apply';
import { EPOCH, STAGING, liveFacts, mergeAll, privilegeFacts } from './restore-apply-fixtures';

describe('normalizeStrategies', () => {
  it('defaults every catalog table to merge-upsert', () => {
    const { ok, resolved } = normalizeStrategies({});
    expect(ok).toBe(true);
    expect(resolved.contests).toBe(DEFAULT_STRATEGY);
    expect(resolved.fsobjects).toBe('merge');
    expect(Object.keys(resolved)).toEqual([...BACKUP_TABLE_NAMES]);
  });

  it('keeps an explicit per-table overwrite choice', () => {
    expect(normalizeStrategies({ contests: 'overwrite' }).resolved.contests).toBe('overwrite');
  });

  it('refuses a table outside the catalog and a value outside the strategies', () => {
    const unknownTable = normalizeStrategies({ monitor_targets: 'merge' } as unknown as ApplyStrategies);
    expect(unknownTable.ok).toBe(false);
    expect(unknownTable.unknown).toEqual(['monitor_targets']);
    const badValue = normalizeStrategies({ contests: 'truncate' } as unknown as ApplyStrategies);
    expect(badValue.ok).toBe(false);
    expect(badValue.unknown).toEqual(['contests']);
  });

  it('lists exactly the three strategies', () => {
    expect(TABLE_STRATEGIES).toEqual(['merge', 'overwrite', 'skip']);
    expect(isTableStrategy('skip')).toBe(true);
    expect(isTableStrategy('drop')).toBe(false);
  });
});

describe('applyOrder', () => {
  it('keeps catalog parent-before-child order and drops skipped tables', () => {
    const order = applyOrder(normalizeStrategies({ teams: 'skip', users: 'skip' }).resolved);
    expect(order).not.toContain('teams');
    expect(order.indexOf('contests')).toBeLessThan(order.indexOf('participations'));
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('participations'));
  });

  it('puts the large-object table last, after every consumer of its digests', () => {
    const order = applyOrder(mergeAll());
    expect(order[order.length - 1]).toBe(LARGE_OBJECT_TABLE);
  });
});

describe('confirmation token', () => {
  const reportId = buildReportId(STAGING, EPOCH);

  it('binds the report id to the staging schema and the validation instant', () => {
    expect(reportId).toBe(`${STAGING}-${EPOCH}`);
    expect(parseReportId(STAGING, reportId)).toBe(EPOCH);
    expect(() => buildReportId('public', EPOCH)).toThrow(/schema/);
  });

  it('accepts the exact token from the validate report', () => {
    expect(checkConfirmToken(STAGING, reportId, EPOCH + 1_000)).toBeNull();
  });

  it('refuses a token issued for another preview', () => {
    expect(checkConfirmToken(STAGING, buildReportId('restore_staging_00000000', EPOCH), EPOCH)).toMatch(/not issued for this preview/);
  });

  it('refuses a malformed or absent token', () => {
    expect(checkConfirmToken(STAGING, '', EPOCH)).toMatch(/confirm token/);
    expect(checkConfirmToken(STAGING, `${STAGING}-not-a-number`, EPOCH)).toMatch(/not issued for this preview/);
    expect(checkConfirmToken(STAGING, STAGING, EPOCH)).toMatch(/not issued for this preview/);
  });

  it('refuses a stale validation and one dated in the future', () => {
    expect(checkConfirmToken(STAGING, reportId, EPOCH + PROMOTE_TOKEN_TTL_MS + 1)).toMatch(/expired/);
    expect(checkConfirmToken(STAGING, reportId, EPOCH - 5_000)).toMatch(/future/);
  });

  it('does not accept a bare timestamp with no preview binding', () => {
    expect(parseReportId(STAGING, String(EPOCH))).toBeNull();
    expect(parseReportId(STAGING, `${STAGING}-${EPOCH}`)).toBe(EPOCH);
  });
});

describe('overwriteParentConflicts', () => {
  it('rejects overwriting a table an applied child still references', () => {
    const strategies = normalizeStrategies({ contests: 'overwrite' }).resolved;
    const errors = overwriteParentConflicts(liveFacts(), strategies);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"contests" cannot be overwritten');
    expect(errors[0]).toContain('participations');
    expect(errors[0]).toMatch(/not deferrable/);
    expect(errors[0]).toMatch(/Skip .* or merge them instead/);
  });

  it('allows the overwrite once every referencing child is skipped', () => {
    const strategies = normalizeStrategies({
      contests: 'overwrite',
      participations: 'skip',
      tasks: 'skip',
      announcements: 'skip',
    }).resolved;
    expect(overwriteParentConflicts(liveFacts(), strategies)).toEqual([]);
  });

  it('names every applied child of an overwritten table', () => {
    const strategies = normalizeStrategies({ submissions: 'overwrite' }).resolved;
    const [error] = overwriteParentConflicts(liveFacts(), strategies);
    expect(error).toContain('"submissions" cannot be overwritten');
    expect(error).toContain('submission_results');
    expect(error).toContain('tokens');
  });

  it('allows overwriting a leaf table that nothing references', () => {
    const strategies = normalizeStrategies({ messages: 'overwrite' }).resolved;
    expect(overwriteParentConflicts(liveFacts(), strategies)).toEqual([]);
  });
});

describe('planApply', () => {
  it('passes for the realistic schema with every table merged', () => {
    const plan = planApply(mergeAll(), liveFacts());
    expect(plan.errors).toEqual([]);
    expect(plan.tableReports).toHaveLength(BACKUP_TABLE_NAMES.length);
    expect(plan.tableReports.map((row) => row.table)).toEqual([...BACKUP_TABLE_NAMES]);
  });

  it('fails when the scratch container that holds the archive rows is gone', () => {
    const plan = planApply(mergeAll(), liveFacts({ scratchAlive: false }));
    expect(plan.errors[0]).toMatch(/scratch container is gone/);
  });

  it('fails for a non-skip table the archive does not carry', () => {
    const facts = liveFacts({ archiveTables: new Set(['contests']) });
    const plan = planApply(mergeAll(), facts);
    expect(plan.errors.some((error) => error.includes('"users"') && error.includes('no rows'))).toBe(true);
  });

  it('fails when a merge table has no live column for a catalog primary key', () => {
    const pkColumns = new Map(liveFacts().livePkColumns);
    pkColumns.set('users', []);
    const plan = planApply(mergeAll(), liveFacts({ livePkColumns: pkColumns }));
    expect(plan.errors.some((error) => error.includes('"users" is merged') && error.includes('primary key id'))).toBe(true);
  });

  it('fails when the archive lacks a live column the insert must write', () => {
    const archiveColumns = new Map(liveFacts().archiveColumns);
    archiveColumns.set('tasks', ['id']);
    const plan = planApply(mergeAll(), liveFacts({ archiveColumns }));
    expect(plan.errors.some((error) => error.includes('"tasks"') && error.includes('name'))).toBe(true);
  });

  it('fails when a foreign-key parent is skipped and absent live', () => {
    const liveColumns = new Map(liveFacts().liveColumns);
    liveColumns.delete('participations');
    const plan = planApply(normalizeStrategies({ participations: 'skip' }).resolved, liveFacts({ liveColumns }));
    expect(plan.errors.some((error) => error.includes('"submissions"') && error.includes('participations'))).toBe(true);
  });

  it('tolerates a skipped parent that is absent from the archive but present live', () => {
    const archiveTables = new Set(BACKUP_TABLE_NAMES);
    archiveTables.delete('participations');
    const plan = planApply(normalizeStrategies({ participations: 'skip' }).resolved, liveFacts({ archiveTables }));
    expect(plan.errors).toEqual([]);
  });

  it('reports the archive-versus-live estimate and the admin_id note per table', () => {
    const rows = new Map(BACKUP_TABLE_NAMES.map((table) => [table, table === 'users' ? 40 : 10]));
    const live = new Map(BACKUP_TABLE_NAMES.map((table) => [table, table === 'users' ? 25 : 4]));
    const plan = planApply(mergeAll({ admins: 'skip' }), liveFacts({ archiveRows: rows, liveRows: live }));
    const users = plan.tableReports.find((row) => row.table === 'users');
    expect(users).toMatchObject({ liveRows: 25, archiveRows: 40, newEstimate: 15 });
    const messages = plan.tableReports.find((row) => row.table === 'messages');
    expect(messages?.warnings.join(' ')).toContain(`"${ADMIN_ID_COLUMN}" will be set to NULL on 10 restored row(s)`);
  });

  it('warns about the large-object plan without failing it', () => {
    const plan = planApply(mergeAll(), liveFacts());
    const blobWarning = plan.warnings.find((warning) => warning.includes(`"${LARGE_OBJECT_TABLE}"`));
    expect(blobWarning).toContain('80 of 100 archive digest(s) are already live');
    expect(blobWarning).toContain('20 digest(s) (about 10 MB)');
  });

  it('warns that a table above the row threshold costs a longer promote, not a refused run', () => {
    const archiveRows = new Map(BACKUP_TABLE_NAMES.map((table) => [table, table === 'submissions' ? LARGE_TABLE_ROW_WARN : 10]));
    const plan = planApply(mergeAll(), liveFacts({ archiveRows }));
    const submissions = plan.tableReports.find((row) => row.table === 'submissions');
    expect(submissions?.warnings.join(' ')).toContain('relays them in chunks');
    expect(submissions?.warnings.join(' ')).toContain('per chunk, not per table');
    expect(plan.tableReports.find((row) => row.table === 'users')?.warnings.join(' ')).not.toContain('relays them in chunks');
    expect(plan.errors).toEqual([]);
  });

  it('warns that the live database size could not be read instead of failing', () => {
    const plan = planApply(mergeAll(), liveFacts({ databaseSizeBytes: 0 }));
    expect(plan.warnings.some((warning) => warning.includes('growth check could not run'))).toBe(true);
    expect(plan.errors).toEqual([]);
  });

  it('warns when an overwrite leaves live rows the archive does not carry', () => {
    const liveRows = new Map(BACKUP_TABLE_NAMES.map((table) => [table, table === LARGE_OBJECT_TABLE ? 40 : 4]));
    const plan = planApply(normalizeStrategies({ fsobjects: 'overwrite' }).resolved, liveFacts({ liveRows }));
    const rows = plan.tableReports.find((row) => row.table === LARGE_OBJECT_TABLE);
    expect(rows?.warnings.join(' ')).toContain('Overwrite replaces only the 10 row(s)');
    expect(rows?.warnings.join(' ')).toContain('30 live row(s) are left alone');
  });

  it('preserves admin_id when admins is applied in the same promote', () => {
    const plan = planApply(mergeAll(), liveFacts());
    for (const table of ADMIN_NULL_TABLES) {
      const report = plan.tableReports.find((row) => row.table === table);
      expect(report?.warnings.join(' '), table).toContain(`"${ADMIN_ID_COLUMN}" is preserved`);
      expect(report?.warnings.join(' '), table).not.toContain('will be set to NULL');
    }
    expect(plan.warnings.join(' ')).not.toContain('"admins" is not applied in this promote');
  });

  it('nulls admin_id and says so when admins is skipped', () => {
    const plan = planApply(mergeAll({ admins: 'skip' }), liveFacts());
    const messages = plan.tableReports.find((row) => row.table === 'messages');
    expect(messages?.warnings.join(' ')).toContain(`"${ADMIN_ID_COLUMN}" will be set to NULL on 10 restored row(s)`);
    const warning = plan.warnings.find((entry) => entry.includes('is not applied in this promote'));
    expect(warning).toContain('messages, questions');
    expect(warning).toContain('Apply "admins" as well');
  });

  it('refuses the promote when a staged username exists live under another id', () => {
    const privileges = privilegeFacts({
      archiveAccounts: [{ id: 7, username: 'ada', enabled: true }],
      liveAccounts: [{ id: 1, username: 'ada', enabled: true }],
      accountConflicts: [{ username: 'ada', stagedId: 7, liveId: 1 }],
    });
    const plan = planApply(mergeAll(), liveFacts({ privileges }));
    expect(plan.errors.some((error) => error.includes('cannot be applied') && error.includes('Rename or remove'))).toBe(true);
  });

  it('carries the privilege delta into the plan warnings', () => {
    const privileges = privilegeFacts({
      archiveAccounts: [{ id: 2, username: 'grace', enabled: true }],
      liveAccounts: [{ id: 1, username: 'ada', enabled: true }],
      archiveMemberships: [{ username: 'grace', groupName: 'Superadmin' }],
      liveMemberships: [],
    });
    const warnings = planApply(mergeAll(), liveFacts({ privileges })).warnings.join('\n');
    expect(warnings).toContain('adds 1 login(s) live does not have: grace');
    expect(warnings).toContain('grace gains Superadmin');
  });
});

describe('adminColumnFor', () => {
  it('nulls the author column only while admins is absent from the promote', () => {
    expect(adminColumnFor('messages', mergeAll({ admins: 'skip' }))).toBe(ADMIN_ID_COLUMN);
    expect(adminColumnFor('messages', mergeAll())).toBeNull();
    expect(adminColumnFor('messages', { messages: 'merge' })).toBe(ADMIN_ID_COLUMN);
  });

  it('names no admin column for a table that carries none, or a skipped one', () => {
    expect(adminColumnFor('users', mergeAll({ admins: 'skip' }))).toBeNull();
    expect(adminColumnFor('admins', mergeAll({ admins: 'skip' }))).toBeNull();
    expect(adminColumnFor('messages', mergeAll({ admins: 'skip', messages: 'skip' }))).toBeNull();
  });
});

describe('the conflicts a plan carries', () => {
  it('carries none for a promote that breaks no rule', () => {
    const plan = planApply(mergeAll(), liveFacts());
    expect(plan.conflicts).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('carries an overwrite-parent conflict structurally, and the same fact in the error list', () => {
    const plan = planApply(normalizeStrategies({ contests: 'overwrite' }).resolved, liveFacts());
    expect(plan.conflicts).toEqual([
      { id: 'fk:contests', kind: 'fk-overwrite', table: 'contests', children: ['announcements', 'tasks', 'participations'] },
    ]);
    expect(plan.errors).toContain(fkOverwriteConflictMessage(plan.conflicts[0] as FkOverwriteConflict));
    expect(plan.errors).toContain(conflictMessage(plan.conflicts[0]!));
  });

  it('raises one account-username conflict per conflicting username, each resolvable on one row', () => {
    const privileges = privilegeFacts({
      archiveAccounts: [{ id: 7, username: 'ada', enabled: true }, { id: 8, username: 'grace', enabled: true }],
      liveAccounts: [{ id: 1, username: 'ada', enabled: true }, { id: 2, username: 'grace', enabled: true }],
      accountConflicts: [
        { username: 'ada', stagedId: 7, liveId: 1 },
        { username: 'grace', stagedId: 8, liveId: 2 },
      ],
    });
    const plan = planApply(mergeAll(), liveFacts({ privileges }));
    expect(plan.conflicts).toHaveLength(2);
    const accounts = plan.conflicts.filter((conflict) => conflict.kind === 'account-username');
    expect(accounts.map((conflict) => conflict.kind === 'account-username' && conflict.pair.username)).toEqual(['ada', 'grace']);
    expect(new Set(accounts.map((conflict) => conflict.id)).size).toBe(2);
    expect(plan.errors).toEqual(plan.conflicts.map(conflictMessage));
  });

  it('reports an overwrite-parent conflict and an account conflict side by side', () => {
    const privileges = privilegeFacts({
      archiveAccounts: [{ id: 7, username: 'ada', enabled: true }],
      liveAccounts: [{ id: 1, username: 'ada', enabled: true }],
      accountConflicts: [{ username: 'ada', stagedId: 7, liveId: 1 }],
    });
    const plan = planApply(normalizeStrategies({ contests: 'overwrite' }).resolved, liveFacts({ privileges }));
    expect(plan.conflicts.map((conflict) => conflict.kind)).toEqual(['fk-overwrite', 'account-username']);
    expect(plan.errors).toHaveLength(2);
  });

  it('keeps the structured FK conflicts equal to the messages the string form returns', () => {
    const strategies = normalizeStrategies({ contests: 'overwrite', submissions: 'overwrite' }).resolved;
    const structured = fkOverwriteConflicts(liveFacts(), strategies);
    expect(structured.map((conflict) => conflict.table)).toEqual(['contests', 'submissions']);
    expect(overwriteParentConflicts(liveFacts(), strategies)).toEqual(structured.map(fkOverwriteConflictMessage));
  });

  it('carries a unique conflict the measurement found, and warns that the check was incomplete', () => {
    const [conflict] = detectUniqueConflicts(
      { table: 'executables', name: 'executables_name_key', columns: ['name'] },
      [{ values: ['runner'], key: ['7'] }],
      [{ values: ['runner'], key: ['1'] }],
    );
    const plan = planApply(mergeAll(), liveFacts({ uniqueConflicts: [conflict!], uniqueCheckSkipped: true }));
    expect(plan.conflicts).toContainEqual(conflict);
    expect(plan.errors).toContain(uniqueValueConflictMessage(conflict!));
    expect(plan.warnings.some((warning) => warning.includes('did not cover every row'))).toBe(true);
  });

  it('says nothing about the unique check when it ran to completion', () => {
    const plan = planApply(mergeAll(), liveFacts());
    expect(plan.conflicts).toEqual([]);
    expect(plan.warnings.some((warning) => warning.includes('did not cover every row'))).toBe(false);
  });
});