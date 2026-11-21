import "server-only";

import { createClient } from "redis";

// Distinct from the counter namespace so a lockout reader never mistakes a
// health counter for a failure bucket.
const HEALTH_NAMESPACE = "cms:captcha:health:";
const HEALTH_FAILURES = 3;
const HEALTH_COOLDOWN_SECONDS = 60;

// In-process fallback when no shared Redis is configured: a provider marked here
// is skipped only by this process. Wrong direction to lose state, but harmless:
// losing health only means the chain does not skip a provider.
const memory = new Map<string, { count: number; expiresAt: number }>();

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url === undefined || url === "" ? null : url;
}

function openConnection(url: string) {
  return createClient({ url });
}

type RedisConnection = ReturnType<typeof openConnection>;

// One connection per process: health is read on login renders, so a connection
// per call would be a connection per page view.
let pooled: Promise<RedisConnection> | null = null;

function client(url: string): Promise<RedisConnection> {
  if (pooled === null) {
    const connection = openConnection(url);
    connection.on("error", () => undefined);
    pooled = connection.connect().then(() => connection);
  }
  return pooled;
}

function memoryHealthy(provider: string): boolean {
  const entry = memory.get(provider);
  if (entry === undefined) return true;
  if (Date.now() >= entry.expiresAt) {
    memory.delete(provider);
    return true;
  }
  return entry.count < HEALTH_FAILURES;
}

export async function isProviderHealthy(provider: string): Promise<boolean> {
  const url = redisUrl();
  if (url === null) return memoryHealthy(provider);
  try {
    const connection = await client(url);
    const raw = await connection.get(`${HEALTH_NAMESPACE}${provider}`);
    return Number(raw ?? 0) < HEALTH_FAILURES;
  } catch {
    // An unreadable store must not remove a provider from the chain.
    return true;
  }
}

export async function recordProviderFailure(provider: string): Promise<void> {
  const url = redisUrl();
  if (url === null) {
    const entry = memory.get(provider);
    const count = (entry && Date.now() < entry.expiresAt ? entry.count : 0) + 1;
    memory.set(provider, { count, expiresAt: Date.now() + HEALTH_COOLDOWN_SECONDS * 1000 });
    return;
  }
  try {
    const connection = await client(url);
    const key = `${HEALTH_NAMESPACE}${provider}`;
    const count = await connection.incr(key);
    await connection.expire(key, HEALTH_COOLDOWN_SECONDS);
    if (count >= HEALTH_FAILURES) {
      console.warn(`CAPTCHA provider ${provider} is unreachable; the chain skips it for ${HEALTH_COOLDOWN_SECONDS}s.`);
    }
  } catch {
    // Health is best-effort: an unwritable store leaves the chain unchanged.
    return;
  }
}

export async function recordProviderSuccess(provider: string): Promise<void> {
  const url = redisUrl();
  if (url === null) {
    memory.delete(provider);
    return;
  }
  try {
    const connection = await client(url);
    await connection.del(`${HEALTH_NAMESPACE}${provider}`);
  } catch {
    return;
  }
}
