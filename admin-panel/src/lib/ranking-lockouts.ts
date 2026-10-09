import { createClient } from 'redis';

// The console counts failures under this namespace; the panel must never touch anything
// outside it, so every key it clears is checked against the prefix first.
const NAMESPACE = 'cms:ranking:login:';

export interface RankingLockout {
  key: string;
  subject: string;
  count: number;
  retryAfterSeconds: number;
}

export function isRankingLockoutKey(key: string): boolean {
  return key.startsWith(NAMESPACE);
}

/** Two key families: one account from one address, and one address across usernames. */
export function describeLockoutKey(key: string): string {
  const raw = key.slice(NAMESPACE.length);
  return raw.startsWith('ip#') ? raw.slice(3) : raw.replace('|', ' from ');
}

/**
 * Every call opens and closes its own connection: the panel uses Redis for this one
 * screen, so a pooled client would be state the operator never benefits from. The
 * connection error handler is attached before connecting, because a refused connection
 * that nobody listens for is reported as an unhandled event rather than to the caller.
 */
async function connected<T>(url: string, work: (client: RedisConnection) => Promise<T>): Promise<T> {
  const client = createClient({ url });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.quit();
  }
}

type RedisConnection = Awaited<ReturnType<typeof openConnection>>;

function openConnection(url: string) {
  return Promise.resolve(createClient({ url }));
}

export async function listRankingLockouts(url: string): Promise<RankingLockout[]> {
  return connected(url, async (client) => {
    const keys: string[] = [];
    for await (const key of client.scanIterator({ MATCH: `${NAMESPACE}*`, COUNT: 100 })) {
      keys.push(String(key));
    }
    const lockouts: RankingLockout[] = [];
    for (const key of keys) {
      const count = Number((await client.get(key)) ?? 0);
      const ttl = Number(await client.ttl(key));
      // A key with no expiry is not a lockout this console wrote, so it is left alone.
      if (count > 0 && ttl > 0) {
        lockouts.push({ key, subject: describeLockoutKey(key), count, retryAfterSeconds: ttl });
      }
    }
    return lockouts.sort((left, right) => right.count - left.count);
  });
}

export async function clearRankingLockouts(
  url: string,
  keys: readonly string[],
): Promise<number> {
  const safe = keys.filter(isRankingLockoutKey);
  if (safe.length === 0) {
    return 0;
  }
  return connected(url, async (client) => Number(await client.del([...safe])));
}

