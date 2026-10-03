import { describe, expect, it } from 'vitest';

import { LOCK_RELEASE_TIMEOUT_MS, STAGING_LOCK_WAIT_MS, acquireStagingLock, advisoryKeyFor } from '@/app/actions/restore-apply-lock';
import type { LockSessionRunner } from '@/app/actions/restore-apply-lock';
import type { LiveDatabaseEnv } from '@/app/actions/restore-apply-measure';
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

/**
 * The lock takes and drops one live session, so a session that records its
 * statements and its closes stands in for the held `psql` and orders the calls
 * exactly as the lock makes them.
 */
function lockSession(refusal: string | null = null) {
  const sent: string[] = [];
  const calls: string[] = [];
  const session: LockSessionRunner = {
    runSql: (sql, timeoutMs) => {
      sent.push(sql);
      calls.push(`runSql:${timeoutMs}`);
      return refusal === null ? Promise.resolve('cms-staging-lock-held') : Promise.reject(new Error(refusal));
    },
    close: () => {
      calls.push('close');
      return Promise.resolve();
    },
  };
  return { session, sent, calls };
}

const env: LiveDatabaseEnv = { POSTGRES_USER: 'cmsuser', POSTGRES_PASSWORD: 'secret', POSTGRES_DB: 'cmsdb' };
const heldWithin = [`runSql:${LOCK_RELEASE_TIMEOUT_MS + STAGING_LOCK_WAIT_MS}`];

describe('advisoryKeyFor', () => {
  it('names one lock per staging schema and keeps it inside the int4 range', () => {
    expect(advisoryKeyFor(STAGING)).toEqual(advisoryKeyFor(STAGING));
    expect(advisoryKeyFor(STAGING)).not.toEqual(advisoryKeyFor('restore_staging_00000000'));
    for (const key of advisoryKeyFor(STAGING)) {
      expect(Number.isInteger(key)).toBe(true);
      expect(Math.abs(key)).toBeLessThanOrEqual(2147483648);
    }
  });
});

describe('acquireStagingLock', () => {
  it('takes the lock with a bounded wait and holds the session open until told to release', async () => {
    const { session, calls } = lockSession();
    const lock = await acquireStagingLock(env, STAGING, session);
    expect(calls).toEqual(heldWithin);
    await lock.release();
    expect(calls).toEqual([...heldWithin, 'close']);
  });

  it('closes the session it opened when the lock is refused, naming the schema and the reason', async () => {
    const { session, calls } = lockSession('canceling statement due to statement timeout');
    await expect(acquireStagingLock(env, STAGING, session)).rejects.toThrow(new RegExp(`${STAGING} is held by another promote.*statement timeout`));
    expect(calls).toEqual([...heldWithin, 'close']);
  });

  it('asks for the session-level lock on its own key, without the schema in the SQL', async () => {
    const { session, sent } = lockSession();
    await acquireStagingLock(env, STAGING, session);
    const [first, second] = advisoryKeyFor(STAGING);
    expect(sent).toEqual([`SET statement_timeout = ${STAGING_LOCK_WAIT_MS};\nSELECT 'cms-staging-lock-held' FROM pg_advisory_lock(${first}, ${second})`]);
    expect(sent[0]).not.toContain(STAGING);
  });
});