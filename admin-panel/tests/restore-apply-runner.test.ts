import { describe, expect, it } from 'vitest';

import { fsobjectInsertSql, mergeInsertSql, stagingLoadSql } from '@/lib/restore-apply';
import type { LargeObjectCopy } from '@/lib/restore-apply';
import { ARGV_PAYLOAD_MAX_BYTES, blobBatchFits, blobBatchInsertSql, blobRowBytes, runStagingLoad, runTableTransaction } from '@/lib/restore-apply-runner';
import type { LiveStatementRunner } from '@/lib/restore-apply-runner';
import { STAGING } from './restore-apply-fixtures';

/**
 * A runner that records what it was asked to run and answers the catalog read
 * the transaction does, so a statement can be read exactly as it would reach
 * `psql -c` without a live database or a container to run it against.
 */
function recordingRunner(sequenceName = 'public.users_id_seq') {
  const statements: string[] = [];
  const runner: LiveStatementRunner = {
    runSql: (sql) => {
      statements.push(sql);
      return Promise.resolve(sql.includes('pg_get_serial_sequence') ? sequenceName : '');
    },
    runCount: () => Promise.resolve(0),
  };
  return { runner, statements };
}

const transaction = {
  table: 'users',
  statements: [mergeInsertSql('users', STAGING, ['id', 'name'], ['id'], null)],
  pkColumns: ['id'],
  expectedAfter: 7,
  statementTimeoutMs: 600_000,
  queryTimeoutMs: 60_000,
  runTimeoutMs: 660_000,
};

describe('runTableTransaction', () => {
  it('runs one table as a single statement with no parameter left to bind', async () => {
    const { runner, statements } = recordingRunner();
    await runTableTransaction(runner, transaction);
    const lines = statements[1].split('\n');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('pg_get_serial_sequence');
    expect(lines[0]).toBe('BEGIN');
    expect(lines[1]).toBe('SET LOCAL statement_timeout = 600000;');
    expect(lines[2]).toBe(transaction.statements[0]);
    expect(lines[3]).toBe(
      "SELECT pg_catalog.setval('public.users_id_seq'::regclass, greatest(coalesce((SELECT max(\"id\") FROM \"public\".\"users\"), 0) + 1, 1), false)::text;",
    );
    expect(lines[4]).toBe('SELECT CASE WHEN (SELECT count(*) FROM "public"."users") = 7 THEN 1 ELSE 1 / 0 END');
    expect(lines[5]).toBe('COMMIT');
    expect(statements.join('\n')).not.toMatch(/\$\d/);
    expect(Buffer.byteLength(statements[1])).toBeLessThan(ARGV_PAYLOAD_MAX_BYTES);
  });

  it('leaves a composite key alone rather than advancing a sequence it does not own', async () => {
    const { runner, statements } = recordingRunner();
    await runTableTransaction(runner, { ...transaction, pkColumns: ['submission_id', 'dataset_id'] });
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain('setval');
  });
});

describe('runStagingLoad', () => {
  it('carries the page as a literal, and refuses one past the argv ceiling', async () => {
    const { runner, statements } = recordingRunner();
    await runStagingLoad(runner, STAGING, 'users', ['id', 'name'], '[{"id":1}]', 600_000);
    expect(statements[0]).toBe(stagingLoadSql(STAGING, 'users', ['id', 'name'], '[{"id":1}]'));
    expect(statements[0]).not.toMatch(/\$\d/);

    const oversized = JSON.stringify([{ id: 1, name: 'x'.repeat(ARGV_PAYLOAD_MAX_BYTES) }]);
    await expect(runStagingLoad(runner, STAGING, 'users', ['id', 'name'], oversized, 600_000)).rejects.toThrow(/"users" carries a page of \d+ byte\(s\).*cannot be staged/);
    expect(statements).toHaveLength(1);
  });
});

describe('blob batches', () => {
  const blob: LargeObjectCopy = { digest: 'abc', encoded: 'A'.repeat(ARGV_PAYLOAD_MAX_BYTES / 2), description: null };

  it('measures a row by what the insert copies out of it', () => {
    expect(blobRowBytes({ ...blob, description: 'a statement' })).toBe(3 + blob.encoded.length + 11);
    expect(blobBatchFits(0, blob)).toBe(true);
    expect(blobBatchFits(blobRowBytes(blob), blob)).toBe(false);
  });

  it('wraps a batch in a transaction and refuses a file past the argv ceiling', () => {
    expect(blobBatchInsertSql([blob])).toBe(`BEGIN;\n${fsobjectInsertSql([blob])};\nCOMMIT;\n`);
    const huge: LargeObjectCopy = { digest: 'oversized', encoded: 'A'.repeat(ARGV_PAYLOAD_MAX_BYTES + 1), description: null };
    expect(() => blobBatchInsertSql([huge])).toThrow(/"oversized".*cannot be copied in one statement/);
  });
});