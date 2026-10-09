const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_BUCKETS = 1000;

// Both bucket families share one map, and usernames are operator-defined, so
// the prefix has to be a shape no `${username}|${ip}` key can ever take: a
// username key always has the `|` separator immediately before the address,
// while this one ends the fixed prefix `#` there. That also keeps these keys
// invisible to the `endsWith('|' + ip)` scan in auth-captcha-helpers, so the
// CAPTCHA threshold keeps reacting to per-account failures only.
const IP_BUCKET_PREFIX = 'ip#';

export const loginBuckets = new Map<string, { count: number; resetAt: number }>();

export function buildIpBucketKey(ip: string): string {
  return `${IP_BUCKET_PREFIX}${ip}`;
}

/** The per-account bucket key, so an unlock clears exactly the bucket a lockout filled. */
export function buildAccountBucketKey(username: string, ip: string): string {
  return `${username}|${ip}`;
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

function incrementBucket(bucketKey: string): void {
  const failed = loginBuckets.get(bucketKey) ?? { count: 0, resetAt: 0 };
  failed.count += 1;
  failed.resetAt = Date.now() + LOGIN_LOCKOUT_MS;
  loginBuckets.set(bucketKey, failed);
}

function isBucketAtLimit(bucketKey: string): boolean {
  const bucket = loginBuckets.get(bucketKey);
  if (bucket === undefined) return false;
  return bucket.count >= MAX_LOGIN_ATTEMPTS && Date.now() < bucket.resetAt;
}

export function pruneExpiredLoginBuckets(): void {
  for (const [key, entry] of loginBuckets) {
    if (Date.now() >= entry.resetAt) loginBuckets.delete(key);
  }
}

export function isRateLimited(bucketKeys: readonly string[]): boolean {
  return bucketKeys.some(isBucketAtLimit);
}

export function recordFailedAttempt(bucketKeys: readonly string[]): void {
  for (const bucketKey of bucketKeys) incrementBucket(bucketKey);
  enforceBucketLimit();
}

export function clearBucket(bucketKeys: readonly string[]): void {
  for (const bucketKey of bucketKeys) loginBuckets.delete(bucketKey);
  enforceBucketLimit();
}
