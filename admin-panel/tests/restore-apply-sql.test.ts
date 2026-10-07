import { describe, expect, it } from 'vitest';

import {
  ADMIN_ID_COLUMN,
  LARGE_OBJECT_CHUNK_BYTES,
  LARGE_OBJECT_TABLE,
  STAGING_SCHEMA_PREFIX,
  archiveDigestBytesForSql,
  archiveDigestBytesSql,
  archiveDigestIntegritySql,
  catalogPrimaryKeys,
  countRowsSql,
  createStagingSchemaSql,
  createStagingTableSql,
  deleteDigestBatchSql,
  dropStagingSchemaSql,
  fsobjectInsertSql,
  insertSelectSql,
  isStagingSchemaName,
  liveDigestQuerySql,
  mergeInsertSql,
  overwriteDeleteSql,
  sequenceNameQuerySql,
  sequenceResetSql,
  setLocalTimeoutSql,
  stagingLoadSql,
  stagingSchemaName,
} from '@/lib/restore-apply';
import type { LargeObjectCopy } from '@/lib/restore-apply';
import { PREVIEW_ID, STAGING } from './restore-apply-fixtures';

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

  it('rebuilds the rows with postgres, naming every column on both sides', () => {
    const sql = stagingLoadSql(STAGING, 'users', ['id', 'name'], '[{"id":1,"name":"Ada"}]');
    expect(sql).toBe(
      'INSERT INTO "restore_staging_a1b2c3d4"."users" ("id", "name") ' +
        'SELECT r."id", r."name" FROM json_populate_recordset(NULL::"restore_staging_a1b2c3d4"."users", \'[{"id":1,"name":"Ada"}]\'::json) AS r',
    );
    expect(sql).not.toContain('SELECT *');
  });

  it('leaves the staging load nothing to bind, because psql -c binds no parameter', () => {
    const sql = stagingLoadSql(STAGING, 'users', ['id', 'name'], '[{"id":1,"name":"it\'s Ada"}]');
    expect(sql).not.toMatch(/\$\d/);
    expect(sql).toContain('\'[{"id":1,"name":"it\'\'s Ada"}]\'::json');
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
      "SELECT pg_catalog.setval('public.users_id_seq'::regclass, " +
        'greatest(coalesce((SELECT max("id") FROM "public"."users"), 0) + 1, 1), false)::text',
    );
  });

  it('carries the resolved name as a literal, leaving psql -c nothing to bind', () => {
    expect(sequenceResetSql('users', 'id', 'public.users_id_seq')).not.toMatch(/\$\d/);
    expect(sequenceResetSql('users', 'id', 'public.users_id_seq')).not.toContain('pg_get_serial_sequence(');
  });

  it('refuses a sequence name that is not a qualified identifier', () => {
    expect(() => sequenceResetSql('users', 'id', 'users_id_seq')).toThrow(/qualified identifier/);
    expect(() => sequenceResetSql('users', 'id', "public.users_id_seq'; DROP TABLE \"users\"; --")).toThrow(/qualified identifier/);
    expect(() => sequenceResetSql('users', 'id', 'public.users id_seq')).toThrow(/qualified identifier/);
  });

  it('builds nothing when the database reports no sequence for the key', () => {
    expect(sequenceResetSql(LARGE_OBJECT_TABLE, 'digest', null)).toBeNull();
    expect(sequenceResetSql('submission_results', 'submission_id', null)).toBeNull();
  });

  it('reads the catalog primary key for the table it is given', () => {
    expect(catalogPrimaryKeys('user_test_results')).toEqual(['user_test_id', 'dataset_id']);
    expect(catalogPrimaryKeys('contests')).toEqual(['id']);
    expect(catalogPrimaryKeys('admins')).toEqual(['id']);
    expect(catalogPrimaryKeys('monitor_targets')).toEqual([]);
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
    expect(LARGE_OBJECT_CHUNK_BYTES).toBe(2048);
    expect(archiveDigestBytesSql()).toContain('* 2048');
    expect(archiveDigestBytesForSql('abc')).toContain('lo_get');
    expect(liveDigestQuerySql()).not.toContain('lo_get');
  });
});