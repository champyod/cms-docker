import { LOGIN_LOCKOUT_MS } from '@/lib/auth-rate-limit';
import { describeLockoutActor, listLoginLockouts, type LockoutActor } from '@/lib/login-lockouts';
import type { LockoutSurface } from '@/lib/lockout-namespaces';
import { prisma } from '@/lib/prisma';

const WINDOW_SECONDS = Math.ceil(LOGIN_LOCKOUT_MS / 1000);

/** One live failure counter, paired with the account's last successful sign-in. */
export interface LoginActivity {
  readonly key: string;
  readonly surface: LockoutSurface;
  readonly subject: string;
  readonly username: string | null;
  readonly ip: string;
  readonly failures: number;
  readonly windowSeconds: number;
  readonly lastFailedAt: Date;
  readonly lastSuccessAt: Date | null;
}

/**
 * The moment a counter's window was last armed. Both web servers reset the TTL on
 * every failed attempt, so the seconds left are the whole window minus the time
 * since the last failure; the subtraction recovers that moment without any
 * per-attempt row being stored.
 */
function windowArmedAt(windowSeconds: number, now: number): Date {
  return new Date(now - (WINDOW_SECONDS - windowSeconds) * 1000);
}

/**
 * The most recent successful sign-in per username, read across both account
 * tables. The `cms:login:` namespace is shared by the contest and admin servers,
 * so one counter can name either a contestant or a panel admin and the lookup
 * has to cover both; where a name appears in each, the later sign-in wins.
 */
async function lastSuccessByUsername(usernames: readonly string[]): Promise<Map<string, Date>> {
  if (usernames.length === 0) return new Map();
  const [admins, users] = await Promise.all([
    prisma.admins.findMany({
      where: { username: { in: [...usernames] } },
      select: { username: true, last_login_at: true },
    }),
    prisma.users.findMany({
      where: { username: { in: [...usernames] } },
      select: { username: true, last_login_at: true },
    }),
  ]);
  const latest = new Map<string, Date>();
  for (const row of [...admins, ...users]) {
    if (row.last_login_at === null) continue;
    const held = latest.get(row.username);
    if (held === undefined || row.last_login_at > held) latest.set(row.username, row.last_login_at);
  }
  return latest;
}

function subjectFor(actor: LockoutActor): string {
  return actor.username === null ? actor.ip : `${actor.username} @ ${actor.ip}`;
}

/**
 * Every live failure counter on every surface, each tagged with its account, its
 * address, its failure count, when it last failed and when the account last
 * signed in successfully. The last two are the detail an operator reads at a
 * glance: the counter is the enforcement, the timestamps are the story.
 */
export async function listLoginActivity(url: string): Promise<LoginActivity[]> {
  const counters = await listLoginLockouts(url);
  const actors = counters.map((counter) => ({ counter, actor: describeLockoutActor(counter.key) }));
  const usernames = [
    ...new Set(
      actors
        .map((entry) => entry.actor?.username)
        .filter((name): name is string => name !== null && name !== undefined),
    ),
  ];
  const lastSuccess = await lastSuccessByUsername(usernames);
  const now = Date.now();
  const rows: LoginActivity[] = [];
  for (const { counter, actor } of actors) {
    if (actor === null) continue;
    rows.push({
      key: counter.key,
      surface: counter.surface,
      subject: subjectFor(actor),
      username: actor.username,
      ip: actor.ip,
      failures: counter.count,
      windowSeconds: counter.retryAfterSeconds,
      lastFailedAt: windowArmedAt(counter.retryAfterSeconds, now),
      lastSuccessAt: actor.username === null ? null : lastSuccess.get(actor.username) ?? null,
    });
  }
  return rows;
}
