import { createClient } from 'redis';

const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_BUCKETS = 1000;

// Both bucket families share one map, and usernames are operator-defined, so
// the prefix has to be a shape no `${username}|${ip}` key can ever take: a
// username key always has the `|` separator immediately before the address,
// while this one ends the fixed prefix `#` there.
const IP_BUCKET_PREFIX = 'ip#';

// The Python web servers count their failures under this same prefix
// (REDIS_KEY_PREFIX in src/cms/server/login_counter_backend.py), so a lockout is
// shared: one failed attempt from the panel and one from the classic admin add
// to the same counters, and a shared store needs Redis to be configured.
const REDIS_KEY_PREFIX = 'cms:login:';
const WINDOW_SECONDS = Math.ceil(LOGIN_LOCKOUT_MS / 1000);

// The in-process mirror: the source of truth when no shared Redis is configured,
// and otherwise unused. Kept as the fallback so a deployment without Redis keeps
// counting, and so the suite can drive the algorithm without a store.
export const loginBuckets = new Map<string, { count: number; resetAt: number }>();

export function buildIpBucketKey(ip: string): string {
  return `${IP_BUCKET_PREFIX}${ip}`;
}

/** The per-account bucket key, so an unlock clears exactly the bucket a lockout filled. */
export function buildAccountBucketKey(username: string, ip: string): string {
  return `${username}|${ip}`;
}

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url === undefined || url === '' ? null : url;
}

function openConnection(url: string) {
  return createClient({ url });
}

type RedisConnection = ReturnType<typeof openConnection>;

// One connection per process: these counters are read on every login attempt.
let pooled: Promise<RedisConnection> | null = null;

function client(url: string): Promise<RedisConnection> {
  if (pooled === null) {
    const connection = openConnection(url);
    connection.on('error', () => undefined);
    pooled = connection.connect().then(() => connection);
  }
  return pooled;
}

function redisKey(bucketKey: string): string {
  return `${REDIS_KEY_PREFIX}${bucketKey}`;
}

async function redisCount(url: string, bucketKey: string): Promise<number> {
  const connection = await client(url);
  const key = redisKey(bucketKey);
  const [raw, ttl] = await Promise.all([connection.get(key), connection.ttl(key)]);
  if (raw === null || ttl <= 0) return 0;
  return Number(raw);
}

function memoryCount(bucketKey: string): number {
  const entry = loginBuckets.get(bucketKey);
  if (entry === undefined || Date.now() >= entry.resetAt) return 0;
  return entry.count;
}

function memoryIncrement(bucketKey: string): void {
  const entry = loginBuckets.get(bucketKey) ?? { count: 0, resetAt: 0 };
  entry.count += 1;
  entry.resetAt = Date.now() + LOGIN_LOCKOUT_MS;
  loginBuckets.set(bucketKey, entry);
}

function evictSafestLoginBucket(): void {
  // A bucket at the limit is an active lockout, so evicting one would hand the
  // caller a fresh counter on the account it was throttling. Any under-limit
  // bucket is cheaper to lose than that; the oldest is the last resort, taken
  // only once every remaining bucket is already at the limit.
  let fallbackKey: string | null = null;
  let fallbackResetAt = Infinity;
  for (const [key, entry] of loginBuckets) {
    if (entry.count < MAX_LOGIN_ATTEMPTS) {
      loginBuckets.delete(key);
      return;
    }
    if (entry.resetAt < fallbackResetAt) {
      fallbackResetAt = entry.resetAt;
      fallbackKey = key;
    }
  }
  if (fallbackKey !== null) loginBuckets.delete(fallbackKey);
}

function enforceBucketLimit(): void {
  if (loginBuckets.size >= MAX_LOGIN_BUCKETS) evictSafestLoginBucket();
}

/** Whether any of *bucketKeys* is at the lockout limit while its window holds. */
export async function isRateLimited(bucketKeys: readonly string[]): Promise<boolean> {
  const url = redisUrl();
  const counts = url === null
    ? bucketKeys.map(memoryCount)
    : await Promise.all(bucketKeys.map((key) => redisCount(url, key)));
  return counts.some((count) => count >= MAX_LOGIN_ATTEMPTS);
}

/** Count one failure against each key, restarting that key's window. */
export async function recordFailedAttempt(bucketKeys: readonly string[]): Promise<void> {
  const url = redisUrl();
  if (url === null) {
    for (const bucketKey of bucketKeys) memoryIncrement(bucketKey);
    enforceBucketLimit();
    return;
  }
  const connection = await client(url);
  await Promise.all(bucketKeys.map((bucketKey) => {
    const key = redisKey(bucketKey);
    return connection.multi().incr(key).expire(key, WINDOW_SECONDS).exec();
  }));
}

/** Forget every key, as a successful login does. */
export async function clearBucket(bucketKeys: readonly string[]): Promise<void> {
  const url = redisUrl();
  if (url === null) {
    for (const bucketKey of bucketKeys) loginBuckets.delete(bucketKey);
    enforceBucketLimit();
    return;
  }
  if (bucketKeys.length === 0) return;
  const connection = await client(url);
  await connection.del(bucketKeys.map(redisKey));
}

/** Drop lapsed local buckets. Under Redis each key expires on its own. */
export async function pruneExpiredLoginBuckets(): Promise<void> {
  if (redisUrl() !== null) return;
  for (const [key, entry] of loginBuckets) {
    if (Date.now() >= entry.resetAt) loginBuckets.delete(key);
  }
}

/** The failure count for one key, zero once its window has lapsed. */
export async function bucketCount(bucketKey: string): Promise<number> {
  const url = redisUrl();
  if (url === null) return memoryCount(bucketKey);
  return redisCount(url, bucketKey);
}

/** Whether one key's count has reached *threshold*. */
export async function bucketAtOrAbove(bucketKey: string, threshold: number): Promise<boolean> {
  return (await bucketCount(bucketKey)) >= threshold;
}
