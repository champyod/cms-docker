import { createClient } from 'redis';

// Every failure counter lives in the shared Redis, one namespace per surface. The
// panel reads and clears them here; a namespace is passed in so each caller can pin
// the exact prefix it is allowed to touch.
export interface RedisLockout {
  key: string;
  subject: string;
  count: number;
  retryAfterSeconds: number;
}

export function lockoutRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url === undefined || url === '' ? null : url;
}

export function isLockoutKey(namespace: string, key: string): boolean {
  return key.startsWith(namespace);
}

/** Two key families: one account from one address, and one address across usernames. */
export function describeLockoutKey(namespace: string, key: string): string {
  const raw = key.slice(namespace.length);
  return raw.startsWith('ip#') ? raw.slice(3) : raw.replace('|', ' from ');
}

/**
 * Every call opens and closes its own connection: the panel uses Redis for these
 * screens only, so a pooled client would be state the operator never benefits from.
 * The connection error handler is attached before connecting, because a refused
 * connection that nobody listens for is reported as an unhandled event rather than
 * to the caller.
 */
function openConnection(url: string) {
  return createClient({ url });
}

type RedisConnection = ReturnType<typeof openConnection>;

async function connected<T>(url: string, work: (client: RedisConnection) => Promise<T>): Promise<T> {
  const client = openConnection(url);
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.quit();
  }
}

export async function listLockouts(url: string, namespace: string): Promise<RedisLockout[]> {
  return connected(url, async (client) => {
    const keys: string[] = [];
    for await (const key of client.scanIterator({ MATCH: `${namespace}*`, COUNT: 100 })) {
      keys.push(String(key));
    }
    const lockouts: RedisLockout[] = [];
    for (const key of keys) {
      const count = Number((await client.get(key)) ?? 0);
      const ttl = Number(await client.ttl(key));
      // A key with no expiry is not a lockout this panel wrote, so it is left alone.
      if (count > 0 && ttl > 0) {
        lockouts.push({ key, subject: describeLockoutKey(namespace, key), count, retryAfterSeconds: ttl });
      }
    }
    return lockouts.sort((left, right) => right.count - left.count);
  });
}

export async function clearLockouts(url: string, namespace: string, keys: readonly string[]): Promise<number> {
  const safe = keys.filter((key) => isLockoutKey(namespace, key));
  if (safe.length === 0) {
    return 0;
  }
  return connected(url, async (client) => Number(await client.del([...safe])));
}
