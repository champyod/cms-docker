import { createClient } from 'redis';

import { LOCKOUT_NAMESPACES } from '@/lib/lockout-namespaces';
import { describeLockoutKey } from '@/lib/redis-lockouts';

// Failures at which a surface refuses the attempt outright (the ban threshold).
export const LOCKOUT_THRESHOLD = 5;
// How long a lockout stays a live alert; once it lapses the same key may alert
// again, which is the intent: a new lockout on the same key is a new event.
const ALERT_TTL_SECONDS = 15 * 60;
const ALERT_NAMESPACE = 'cms:captcha:lockout-alerts:';

export interface LockoutAlert {
  key: string;
  subject: string;
  count: number;
  retryAfterSeconds: number;
}

/** True when a counter has reached the refusal threshold. */
export function isLockout(count: number, threshold: number = LOCKOUT_THRESHOLD): boolean {
  return count >= threshold;
}

/** The operator-facing line for one lockout. */
export function alertDetail(lockout: LockoutAlert): string {
  return `${lockout.subject} is locked out after ${lockout.count} failed attempts (${lockout.retryAfterSeconds}s left).`;
}

/**
 * Every lockout that has not already been alerted, claiming each as it is
 * returned. The claim is a `SET NX` marker whose TTL matches the lockout window,
 * so a run cannot page twice for one lockout but a recurrence after the window
 * pages again. An unreachable store yields no alerts rather than throwing.
 */
export async function scanLockoutAlerts(url: string): Promise<LockoutAlert[]> {
  const connection = createClient({ url });
  connection.on('error', () => undefined);
  await connection.connect();
  try {
    const found: LockoutAlert[] = [];
    for (const entry of LOCKOUT_NAMESPACES) {
      for await (const raw of connection.scanIterator({ MATCH: `${entry.namespace}*`, COUNT: 100 })) {
        const key = String(raw);
        const [value, ttl] = await Promise.all([connection.get(key), connection.ttl(key)]);
        const count = Number(value ?? 0);
        if (ttl <= 0 || !isLockout(count)) continue;
        const claimed = await connection.set(`${ALERT_NAMESPACE}${key}`, '1', { NX: true, EX: ALERT_TTL_SECONDS });
        if (claimed === null) continue;
        found.push({ key, subject: describeLockoutKey(entry.namespace, key), count, retryAfterSeconds: ttl });
      }
    }
    return found;
  } catch {
    return [];
  } finally {
    await connection.quit();
  }
}
