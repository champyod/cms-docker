import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHERE the live database password travels when a postgres client is spawned.
 *
 * The defect this pins: the password was an argv element (`-e PGPASSWORD=...`),
 * so `/proc/<pid>/cmdline` — world readable — held the live database password
 * for as long as the client ran, which for the staging lock is a whole promote.
 * The fix is that the child's ENVIRONMENT carries it and the command line only
 * names the variable, since `docker exec -e NAME` copies NAME from the client's
 * own environment and `/proc/<pid>/environ` is readable only by its owner.
 *
 * Every client is replaced here: what is under test is how the process is
 * spawned, not what the database answered.
 */
const SECRET = 'live-db-password-that-must-not-be-visible';

const harness = vi.hoisted(() => ({
  execFile: [] as {
    file: string;
    args: readonly string[];
    options: { env?: Record<string, string | undefined> } | undefined;
  }[],
  spawn: [] as {
    file: string;
    args: readonly string[];
    options: { env?: Record<string, string | undefined> } | undefined;
  }[],
}));

/** Printed by the lock statement itself; the lock session resolves on it. */
const LOCK_HELD_MARKER = 'cms-staging-lock-held';

interface FakeSession {
  readonly child: EventEmitter;
  readonly written: string[];
}

/**
 * A stand-in for the long-lived `psql` the lock keeps open: it answers the
 * statement it is given with the marker, and ends its session when its input
 * is closed.
 */
function fakeLockSession(): FakeSession {
  const child = new EventEmitter();
  const written: string[] = [];

  const stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  stdout.resume = () => undefined;
  const stderr = new EventEmitter() as EventEmitter & { resume: () => void };
  stderr.resume = () => undefined;
  const stdin = new EventEmitter() as EventEmitter & {
    write: (chunk: string) => boolean;
    end: () => void;
  };
  stdin.write = (chunk: string) => {
    written.push(chunk);
    queueMicrotask(() => stdout.emit('data', Buffer.from(`${LOCK_HELD_MARKER}\n`)));
    return true;
  };
  stdin.end = () => {
    setImmediate(() => child.emit('exit', 0, null));
  };

  Object.assign(child, { stdout, stderr, stdin, kill: () => true });
  return { child, written };
}

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (
      file: string,
      args: readonly string[],
      options: { env?: Record<string, string | undefined> } | undefined,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      harness.execFile.push({ file, args, options });
      callback(null, { stdout: '0\n', stderr: '' });
    },
    spawn: (file: string, args: readonly string[], options: { env?: Record<string, string | undefined> } | undefined) => {
      harness.spawn.push({ file, args, options });
      const session = fakeLockSession();
      return session.child;
    },
  };
});

vi.mock('@/lib/permissions', () => ({ ensurePermission: async () => undefined }));

import { acquireStagingLock } from '@/app/actions/restore-apply-lock';
import { liveClientSpawn, postgresClientSpawn, runLiveSql } from '@/app/actions/restore-apply-measure';
import type { LiveDatabaseEnv } from '@/app/actions/restore-apply-measure';

const ENV: LiveDatabaseEnv = { POSTGRES_USER: 'cmsuser', POSTGRES_PASSWORD: SECRET, POSTGRES_DB: 'cmsdb' };

/** Every element of a command line, as a shell would show another local user. */
function visibleOnTheCommandLine(args: readonly string[]): string {
  return args.join(' ');
}

beforeEach(() => {
  harness.execFile.length = 0;
  harness.spawn.length = 0;
});

describe('a live statement', () => {
  it('spawns psql with the password in its environment and never in argv', async () => {
    await runLiveSql(ENV, 'SELECT 1', 1_000);

    const [invocation] = harness.execFile;
    expect(invocation?.file).toBe('docker');
    // The whole command line is asserted, so the password cannot come back in a
    // different position and go unnoticed.
    expect(invocation?.args).toEqual([
      'exec', '-e', 'PGPASSWORD', '-e', 'PGOPTIONS', 'cms-database',
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'cmsuser', '-d', 'cmsdb', '-t', '-A', '-c', 'SELECT 1',
    ]);
    expect(visibleOnTheCommandLine(invocation?.args ?? [])).not.toContain(SECRET);
    expect(invocation?.args).not.toContain(`PGPASSWORD=${SECRET}`);
    expect(invocation?.options?.env?.PGPASSWORD).toBe(SECRET);
  });
});

describe('the staging lock session', () => {
  it('spawns its psql with the password in its environment and never in argv', async () => {
    const lock = await acquireStagingLock(ENV, 'restore_staging_a1b2c3d4');
    await lock.release();

    const [invocation] = harness.spawn;
    expect(invocation?.file).toBe('docker');
    expect(invocation?.args).toEqual([
      'exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGOPTIONS', 'cms-database',
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'cmsuser', '-d', 'cmsdb', '-t', '-A', '-q',
    ]);
    expect(visibleOnTheCommandLine(invocation?.args ?? [])).not.toContain(SECRET);
    expect(invocation?.args).not.toContain(`PGPASSWORD=${SECRET}`);
    expect(invocation?.options?.env?.PGPASSWORD).toBe(SECRET);
  });
});

describe('postgresClientSpawn', () => {
  it('names the password variable instead of valuing it, for every container it is given', () => {
    const live = liveClientSpawn(ENV, ['psql'], { interactive: true });
    const scratch = postgresClientSpawn(ENV, 'cms-restore-preview-x', ['pg_restore']);

    expect(live.args).toEqual(['exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGOPTIONS', 'cms-database', 'psql']);
    expect(scratch.args).toEqual(['exec', '-e', 'PGPASSWORD', '-e', 'PGOPTIONS', 'cms-restore-preview-x', 'pg_restore']);
    for (const client of [live, scratch]) {
      expect(visibleOnTheCommandLine(client.args)).not.toContain(SECRET);
      expect(client.env.PGPASSWORD).toBe(SECRET);
    }
  });

  it('keeps the rest of the panel environment so the child is otherwise unchanged', () => {
    const client = postgresClientSpawn(ENV, 'cms-database', ['psql']);
    expect(client.env.PATH).toBe(process.env.PATH);
  });

  it('gives every spawned client an actor, because a restore writes through psql and not Prisma', () => {
    // WHY this is asserted here: a restore is a bulk write that never touches the panel's
    // actor-aware Prisma client, and every table is row-level secured on cms.actor. Without this
    // the restore fails closed in the middle — some tables rejected, the count read back as zero —
    // which an operator would read as "the restore did nothing" rather than "the restore was
    // refused". `system:migration` is the named identity the policies admit for bulk writes.
    const client = postgresClientSpawn(ENV, 'cms-database', ['psql']);
    expect(client.env.PGOPTIONS).toBe('-c cms.actor=system:migration');
    // And the value travels in the environment, never in argv, for the same reason the password does.
    expect(client.args.some((arg) => arg.includes('cms.actor'))).toBe(false);
  });
});
