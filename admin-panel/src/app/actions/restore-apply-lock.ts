/**
 * One promote at a time per staging schema.
 *
 * A session-level `pg_advisory_lock` is held until its session ends, so the lock
 * lives in a `psql` session this process keeps open for the run and ends on every
 * exit, which is also how the server drops it. The per-table transactions never
 * ask for this key, so what the lock stops is a second operator's drop, reload
 * and merge interleaving with this one. The wait is bounded by a statement
 * timeout, so a promote that cannot have the lock refuses instead of hanging.
 *
 * Why the lock carries `backup:restore` itself: this directory is scanned as a
 * set of entry points, so the lock is read as one that can be taken on its
 * own. The promote gates the same key, so the repeat check costs one cached
 * session read and never widens or narrows what the caller may already do.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import { ensurePermission } from '@/lib/permissions';
import type { LiveDatabaseEnv } from './restore-apply-measure';
import { describeFailure } from './restore-preview-run';

/** What the lock needs from a live session: one statement sent, what the server printed, one way to end it. */
export interface LockSessionRunner {
  readonly runSql: (sql: string, timeoutMs: number) => Promise<string>;
  readonly close: () => Promise<void>;
}

export interface StagingLock {
  /** Ending the session is the whole release: the server drops a session-level lock when its session ends. */
  readonly release: () => Promise<void>;
}

/** The container the live statements reach; the lock has to be taken in that same database. */
const LIVE_CONTAINER = 'cms-database';
/** How long a promote waits for the other one on the same preview before it refuses to start. */
export const STAGING_LOCK_WAIT_MS = 60_000;
/** How long a release waits for its session to end, and the grace the request itself gets on top of the wait. */
export const LOCK_RELEASE_TIMEOUT_MS = 5_000;
/** Printed by the lock statement itself, so what proves the lock is held comes from the server. */
const LOCK_HELD_MARKER = 'cms-staging-lock-held';
const FNV_1A_PRIME = 0x01000193;
const FNV_1A_OFFSET = 0x811c9dc5;

/** One `int4` pair per staging schema, hashed here so no schema name is interpolated into SQL text. */
export function advisoryKeyFor(staging: string): readonly [number, number] {
  const half = (text: string): number => {
    let hash = FNV_1A_OFFSET;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), FNV_1A_PRIME);
    return hash | 0;
  };
  return [half(staging), half(`${staging}/1`)];
}

/**
 * Takes the lock for the caller, or refuses and names why. A refusal closes the
 * session it opened, so a promote that could not have the lock leaves nothing
 * behind; a grant hands back a release that ends that same session.
 */
export async function acquireStagingLock(env: LiveDatabaseEnv, staging: string, session: LockSessionRunner = dockerLockSession(env)): Promise<StagingLock> {
  await ensurePermission('backup:restore');
  const [first, second] = advisoryKeyFor(staging);
  const request = [`SET statement_timeout = ${STAGING_LOCK_WAIT_MS}`, `SELECT '${LOCK_HELD_MARKER}' FROM pg_advisory_lock(${first}, ${second})`].join(';\n');
  try {
    await session.runSql(request, STAGING_LOCK_WAIT_MS + LOCK_RELEASE_TIMEOUT_MS);
  } catch (error) {
    await session.close();
    throw new Error(`${staging} is held by another promote: ${describeFailure(error)}`);
  }
  return { release: () => session.close() };
}

function dockerLockSession(env: LiveDatabaseEnv): LockSessionRunner {
  const args = ['exec', '-i', '-e', `PGPASSWORD=${env.POSTGRES_PASSWORD}`, LIVE_CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB, '-t', '-A', '-q'];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  // A held session is never cut short from here: its bound is the statement timeout the request sets on the server.
  return { runSql: (sql) => printLockMarker(child, sql), close: () => endSession(child) };
}

/**
 * Resolves on the marker the lock statement prints, and rejects with what the
 * server said instead. The listeners stay attached after a grant so a session
 * that dies later cannot raise an unhandled error, and the pipes are drained
 * because a held session is left to idle rather than to fill a buffer.
 */
function printLockMarker(child: ChildProcessWithoutNullStreams, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let printed = '';
    let refused = '';
    const giveUp = (reason: string): void => reject(new Error(reason));
    child.stdout.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8');
      if (!printed.includes(LOCK_HELD_MARKER)) return;
      for (const stream of [child.stdout, child.stderr]) { stream.removeAllListeners('data'); stream.resume(); }
      resolve(LOCK_HELD_MARKER);
    });
    child.stderr.on('data', (chunk: Buffer) => { refused += chunk.toString('utf8'); });
    child.stdin.on('error', (error: Error) => giveUp(describeFailure(error)));
    child.once('error', (error: Error) => giveUp(describeFailure(error)));
    child.once('exit', () => giveUp(refused.trim() || 'the session ended before the lock was granted'));
    child.stdin.write(`${sql};\n`);
  });
}

/** Closing the input ends the session and the lock with it; the kill is only for a session that outlives that. */
async function endSession(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exited = once(child, 'exit');
  child.stdin.end();
  const ended = await Promise.race([exited.then(() => true), delay(LOCK_RELEASE_TIMEOUT_MS).then(() => false)]);
  if (!ended) child.kill('SIGKILL');
}
