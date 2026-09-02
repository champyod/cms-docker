const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_BUCKETS = 1000;

export const loginBuckets = new Map<string, { count: number; resetAt: number }>();

function evictOldestLoginBucket(): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  for (const [key, entry] of loginBuckets) {
    if (entry.resetAt < oldestResetAt) {
      oldestResetAt = entry.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) loginBuckets.delete(oldestKey);
}

function enforceBucketLimit(): void {
  if (loginBuckets.size >= MAX_LOGIN_BUCKETS) evictOldestLoginBucket();
}

export function pruneExpiredLoginBuckets(): void {
  for (const [key, entry] of loginBuckets) {
    if (Date.now() >= entry.resetAt) loginBuckets.delete(key);
  }
}

export function isRateLimited(bucketKey: string): boolean {
  const bucket = loginBuckets.get(bucketKey);
  return bucket !== undefined && bucket.count >= MAX_LOGIN_ATTEMPTS && Date.now() < bucket.resetAt;
}

export function recordFailedAttempt(bucketKey: string): void {
  const failed = loginBuckets.get(bucketKey) ?? { count: 0, resetAt: 0 };
  failed.count += 1;
  failed.resetAt = Date.now() + LOGIN_LOCKOUT_MS;
  loginBuckets.set(bucketKey, failed);
  enforceBucketLimit();
}

export function clearBucket(bucketKey: string): void {
  loginBuckets.delete(bucketKey);
  enforceBucketLimit();
}
