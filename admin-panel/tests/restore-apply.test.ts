import { describe, expect, it } from 'vitest';

import { BACKUP_TABLE_NAMES } from '@/lib/backup-table-catalog';
import {
  ADMIN_ID_COLUMN,
  DEFAULT_STRATEGY,
  LARGE_OBJECT_TABLE,
  LARGE_TABLE_ROW_WARN,
  PROMOTE_TOKEN_TTL_MS,
  STAGING_SCHEMA_PREFIX,
  TABLE_STRATEGIES,
  applyOrder,
  buildReportId,
  archiveDigestBytesForSql,
  archiveDigestBytesSql,
  archiveDigestIntegritySql,
  catalogPrimaryKeys,
  checkConfirmToken,
  countRowsSql,
  createStagingSchemaSql,
  deleteDigestBatchSql,
  createStagingTableSql,
  dropStagingSchemaSql,
  fsobjectInsertSql,
  insertSelectSql,
  isStagingSchemaName,
  isTableStrategy,
  liveDigestQuerySql,
  mergeInsertSql,
  normalizeStrategies,
  overwriteDeleteSql,
  overwriteParentConflicts,
  parseReportId,
  planApply,
  scratchExportSql,
  sequenceNameQuerySql,
  sequenceResetSql,
  setLocalTimeoutSql,
  stagingLoadSql,
  stagingSchemaName,
} from '@/lib/restore-apply';
import type { ApplyFacts, ApplyStrategies, LargeObjectCopy, TableStrategy } from '@/lib/restore-apply';

const PREVIEW_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const STAGING = 'restore_staging_a1b2c3d4';
const EPOCH = Date.UTC(2026, 9, 2, 12, 0, 0);

/** Every catalog table merged, unless a test narrows the selection. */
function mergeAll(overrides: ApplyStrategies = {}): Record<string, TableStrategy> {
  const strategies: Record<string, TableStrategy> = {};
  for (const table of BACKUP_TABLE_NAMES) strategies[table] = 'merge';
  return { ...strategies, ...overrides };
}

/**
 * The live side of a realistic CMS schema: serial id primary keys, composite
 * keys on the two result tables, a text key on fsobjects, nullable admin_id on
 * the three admin-referencing tables, and the foreign keys Prisma creates as
 * plain non-deferrable constraints.
 */
function liveFacts(overrides: Partial<ApplyFacts> = {}): ApplyFacts {
  const tables = BACKUP_TABLE_NAMES;
  const composite = new Set(['submission_results', 'user_test_results']);
  return {
    scratchAlive: true,
    archiveTables: new Set(tables),
    archiveRows: new Map(tables.map((table) => [table, 10])),
    archiveColumns: new Map(tables.map((table) => [table, table === LARGE_OBJECT_TABLE ? ['digest', 'loid', 'description'] : ['id', 'name']])),
    liveRows: new Map(tables.map((table) => [table, 4])),
    liveColumns: new Map(tables.map((table) => [table, table === LARGE_OBJECT_TABLE ? ['digest', 'loid', 'description'] : ['id', 'name']])),
    livePkColumns: new Map(
      tables.map((table) => [
        table,
        composite.has(table)
          ? table === 'submission_results'
            ? ['submission_id', 'dataset_id']
            : ['user_test_id', 'dataset_id']
          : [table === LARGE_OBJECT_TABLE ? 'digest' : 'id'],
      ]),
    ),
    liveFkParents: new Map([
      ['announcements', ['contests', 'admins']],
      ['attachments', ['tasks']],
      ['datasets', ['tasks']],
      ['evaluations', ['datasets', 'submission_results', 'submissions', 'testcases']],
      ['files', ['submissions']],
      ['messages', ['participations', 'admins']],
      ['participations', ['contests', 'teams', 'users']],
      ['questions', ['participations', 'admins']],
      ['statements', ['tasks']],
      ['submission_results', ['datasets', 'submissions']],
      ['submissions', ['participations', 'tasks']],
      ['tasks', ['contests']],
      ['teams', ['users']],
      ['testcases', ['datasets']],
      ['tokens', ['submissions']],
      ['user_tests', ['participations', 'tasks']],
    ]),
    archiveDigestCount: 100,
    archiveDigestBytes: 40 * 1024 * 1024,
    liveDigestCount: 80,
    missingDigestCount: 20,
    missingDigestBytes: 10 * 1024 * 1024,
    databaseSizeBytes: 1024 * 1024 * 1024,
    ...overrides,
  };
}

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
    const unknownTable = normalizeStrategies({ admins: 'merge' } as unknown as ApplyStrategies);
    expect(unknownTable.ok).toBe(false);
    expect(unknownTable.unknown).toEqual(['admins']);
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

describe('stagingSchemaName', () => {
  it('derives an allowlisted [a-z0-9_] name from the preview id', () => {
    expect(stagingSchemaName(PREVIEW_ID)).toBe(STAGING);
    expect(STAGING).toBe(`${STAGING_SCHEMA_PREFIX}${PREVIEW_ID.slice(0, 8)}`);
    expect(isStagingSchemaName(STAGING)).toBe(true);
  });

  it('refuses a preview id that is not the preview id shape', () => {
    expect(() => stagingSchemaName('../../etc')).toThrow(/preview id/);
    expect(() => stagingSchemaName('A1B2C3D4')).toThrow(/preview id/);
  });

  it('refuses to build schema SQL from a name outside the allowlist', () => {
    expect(() => createStagingSchemaSql('public')).toThrow(/schema/);
    expect(() => dropStagingSchemaSql('restore_staging_XYZ')).toThrow(/schema/);
    expect(createStagingSchemaSql(STAGING)).toBe('CREATE SCHEMA "restore_staging_a1b2c3d4"');
    expect(dropStagingSchemaSql(STAGING)).toBe('DROP SCHEMA IF EXISTS "restore_staging_a1b2c3d4" CASCADE');
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
    const plan = planApply(mergeAll(), liveFacts({ archiveRows: rows, liveRows: live }));
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

  it('warns that a table big enough to exceed the export ceiling stops the run', () => {
    const archiveRows = new Map(BACKUP_TABLE_NAMES.map((table) => [table, table === 'submissions' ? LARGE_TABLE_ROW_WARN : 10]));
    const plan = planApply(mergeAll(), liveFacts({ archiveRows }));
    const submissions = plan.tableReports.find((row) => row.table === 'submissions');
    expect(submissions?.warnings.join(' ')).toContain('serialises as one document per table');
    expect(plan.tableReports.find((row) => row.table === 'users')?.warnings.join(' ')).not.toContain('serialises');
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
});

describe('merge and overwrite statements', () => {
  it('upserts on the catalog primary key and never writes the key itself', () => {
    const sql = mergeInsertSql('users', STAGING, ['id', 'name', 'last_login_at'], ['id'], null);
    expect(sql).toBe(
      'INSERT INTO "public"."users" ("id", "name", "last_login_at") ' +
        'SELECT "id", "name", "last_login_at" FROM "restore_staging_a1b2c3d4"."users" ' +
        'ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "last_login_at" = EXCLUDED."last_login_at"',
    );
  });

  it('conflicts on the whole composite key and does nothing when the key is every column', () => {
    expect(mergeInsertSql('submission_results', STAGING, ['submission_id', 'dataset_id'], ['submission_id', 'dataset_id'], null)).toBe(
      'INSERT INTO "public"."submission_results" ("submission_id", "dataset_id") ' +
        'SELECT "submission_id", "dataset_id" FROM "restore_staging_a1b2c3d4"."submission_results" ' +
        'ON CONFLICT ("submission_id", "dataset_id") DO NOTHING',
    );
  });

  it('replaces the archive admin_id with a literal NULL instead of quoting it', () => {
    const sql = mergeInsertSql('messages', STAGING, ['id', 'body', 'admin_id'], ['id'], ADMIN_ID_COLUMN);
    expect(sql).toContain('SELECT "id", "body", NULL FROM');
    expect(sql).not.toContain('EXCLUDED."admin_id"');
    expect(sql).toContain('"body" = EXCLUDED."body"');
  });

  it('matches a composite key row-wise on the delete half of an overwrite', () => {
    expect(overwriteDeleteSql(STAGING, 'submission_results', ['submission_id', 'dataset_id'])).toBe(
      'DELETE FROM "public"."submission_results" AS "live" USING "restore_staging_a1b2c3d4"."submission_results" AS "staged" ' +
        'WHERE ("live"."submission_id", "live"."dataset_id") = ("staged"."submission_id", "staged"."dataset_id")',
    );
  });

  it('quotes every alias and column in the delete', () => {
    const sql = overwriteDeleteSql(STAGING, 'users', ['id']);
    expect(sql).toContain('AS "live"');
    expect(sql).toContain('"live"."id" = "staged"."id"');
    expect(sql).not.toMatch(/\slive\./);
  });

  it('inserts the staging rows plainly after the overwrite delete', () => {
    expect(insertSelectSql('users', STAGING, ['id', 'name'], null)).toBe(
      'INSERT INTO "public"."users" ("id", "name") SELECT "id", "name" FROM "restore_staging_a1b2c3d4"."users"',
    );
  });

  it('refuses to build a merge with no column list', () => {
    expect(() => mergeInsertSql('users', STAGING, [], ['id'], null)).toThrow(/no columns/);
  });
});

describe('staging load statements', () => {
  it('shapes the staging table from the live table with a bare LIKE', () => {
    expect(createStagingTableSql(STAGING, 'contests')).toBe(
      'CREATE TABLE "restore_staging_a1b2c3d4"."contests" (LIKE "public"."contests")',
    );
    expect(createStagingTableSql(STAGING, 'contests')).not.toContain('INCLUDING');
  });

  it('exports archive rows as one JSON document ordered by the primary key', () => {
    expect(scratchExportSql('users', ['id', 'name'], ['id'])).toBe(
      'SELECT coalesce(json_agg(row_to_json(s))::text, \'[]\') FROM ' +
        '(SELECT "id", "name" FROM "public"."users" ORDER BY "id") AS s',
    );
  });

  it('rebuilds the rows with postgres, naming every column on both sides', () => {
    const sql = stagingLoadSql(STAGING, 'users', ['id', 'name']);
    expect(sql).toBe(
      'INSERT INTO "restore_staging_a1b2c3d4"."users" ("id", "name") ' +
        'SELECT r."id", r."name" FROM json_populate_recordset(NULL::"restore_staging_a1b2c3d4"."users", $1::json) AS r',
    );
    expect(sql).not.toContain('SELECT *');
  });

  it('bounds a statement timeout and counts rows for the before-and-after audit', () => {
    expect(setLocalTimeoutSql(90_000)).toBe('SET LOCAL statement_timeout = 90000');
    expect(setLocalTimeoutSql(0)).toBe('SET LOCAL statement_timeout = 1');
    expect(countRowsSql('public', 'users')).toBe('SELECT count(*)::bigint::text FROM "public"."users"');
  });
});

describe('sequenceResetSql', () => {
  it('advances a sequence the live database reported for the key', () => {
    expect(sequenceResetSql('users', 'id', 'public.users_id_seq')).toBe(
      'SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence($1, $2), ' +
        'greatest(coalesce((SELECT max("id") FROM "public"."users"), 0) + 1, 1), false)::text',
    );
  });

  it('builds nothing when the database reports no sequence for the key', () => {
    expect(sequenceResetSql(LARGE_OBJECT_TABLE, 'digest', null)).toBeNull();
    expect(sequenceResetSql('submission_results', 'submission_id', null)).toBeNull();
  });

  it('reads the catalog primary key for the table it is given', () => {
    expect(catalogPrimaryKeys('user_test_results')).toEqual(['user_test_id', 'dataset_id']);
    expect(catalogPrimaryKeys('contests')).toEqual(['id']);
    expect(catalogPrimaryKeys('admins')).toEqual([]);
  });

  it('asks the live database which key owns a sequence instead of assuming one', () => {
    expect(sequenceNameQuerySql('users', 'id')).toContain('pg_get_serial_sequence');
    expect(sequenceNameQuerySql('users', 'id')).toContain("'public.users', 'id'");
  });
});

describe('large objects', () => {
  const copy: LargeObjectCopy = { digest: 'abc123', encoded: 'aGVsbG8=', description: 'statement v1' };

  it('mints a live oid with lo_from_bytea and never reuses the archive oid', () => {
    const sql = fsobjectInsertSql([copy]);
    expect(sql).toContain('lo_from_bytea(0, decode(\'aGVsbG8=\', \'base64\'))');
    expect(sql).not.toMatch(/VALUES \(\$1/);
    expect(sql).toContain('ON CONFLICT ("digest") DO NOTHING');
    expect(sql).toContain('("digest", "loid", "description")');
  });

  it('escapes quote characters in a digest and a description', () => {
    const sql = fsobjectInsertSql([{ ...copy, digest: "a'b", description: "it's" }]);
    expect(sql).toContain("'a''b'");
    expect(sql).toContain("'it''s'");
  });

  it('writes a real NULL for a missing description instead of an empty string', () => {
    expect(fsobjectInsertSql([{ ...copy, description: null }])).toContain("'base64')), NULL)");
    expect(fsobjectInsertSql([{ ...copy, description: '' }])).toContain("'base64')), '')");
  });

  it('refuses to build an insert with no rows', () => {
    expect(() => fsobjectInsertSql([])).toThrow(/no rows/);
  });

  it('deletes live digests in a bounded batch rather than one unbounded list', () => {
    expect(deleteDigestBatchSql(['aa', "b'b"])).toBe(
      'DELETE FROM "public"."fsobjects" WHERE "digest" IN (\'aa\', \'b\'\'b\')',
    );
    expect(() => deleteDigestBatchSql([])).toThrow(/no digests/);
  });

  it('measures archive blob bytes in the scratch container, not the live one', () => {
    expect(archiveDigestIntegritySql()).toContain('FROM pg_largeobject AS l');
    expect(archiveDigestBytesSql()).toContain('* 8192');
    expect(archiveDigestBytesForSql('abc')).toContain('lo_get');
    expect(liveDigestQuerySql()).not.toContain('lo_get');
  });
});