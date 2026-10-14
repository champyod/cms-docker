import { createClient } from 'redis';

/**
 * The four login faces a failed attempt can be counted on. The keys match
 * `login_surfaces.key`, so an attempt carries the key and the panel resolves the
 * id and label from the table.
 */
export const LOGIN_SURFACE_KEYS = ['contest', 'admin-classic', 'admin-panel', 'ranking'] as const;

export type LoginSurfaceKey = (typeof LOGIN_SURFACE_KEYS)[number];

/** One failed sign-in, as stored in a counter key's attempt list. */
export interface LoginAttempt {
  readonly at: number;
  readonly ip: string;
  readonly surfaceKey: LoginSurfaceKey;
  readonly path: string;
  readonly ua: string | null;
}

/** The caller's context for one failure; the writer supplies the timestamp. */
export interface LoginAttemptContext {
  readonly ip: string;
  readonly surfaceKey: LoginSurfaceKey;
  readonly path: string;
  readonly ua: string | null;
}

/** Entries kept per counter key; a brute-force run cannot grow a list past this. */
export const LOGIN_ATTEMPT_LIMIT = 50;

/**
 * The attempt-list prefix for a counter namespace. The trailing colon is replaced,
 * not kept, so `cms:login:` becomes `cms:login-attempts:` — which the counter scan
 * (`cms:login:*`) cannot match. Keeping the colon would make listLockouts read an
 * attempt list as a counter and GET a list key.
 */
export function attemptPrefix(counterNamespace: string): string {
  return `${counterNamespace.replace(/:$/, '')}-attempts:`;
}

export function attemptListKey(counterNamespace: string, bucketKey: string): string {
  return `${attemptPrefix(counterNamespace)}${bucketKey}`;
}

export function buildAttempt(context: LoginAttemptContext, at: number = Date.now()): LoginAttempt {
  return { at, ip: context.ip, surfaceKey: context.surfaceKey, path: context.path, ua: context.ua };
}

export function serializeAttempt(attempt: LoginAttempt): string {
  return JSON.stringify(attempt);
}

function isLoginSurfaceKey(value: unknown): value is LoginSurfaceKey {
  return typeof value === 'string' && (LOGIN_SURFACE_KEYS as readonly string[]).includes(value);
}

/** Parse one stored entry, or null when it is not a shape this writer produced. */
export function parseAttempt(raw: string): LoginAttempt | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== 'number' || typeof record.ip !== 'string' || typeof record.path !== 'string') return null;
  if (!isLoginSurfaceKey(record.surfaceKey)) return null;
  return {
    at: record.at,
    ip: record.ip,
    surfaceKey: record.surfaceKey,
    path: record.path,
    ua: typeof record.ua === 'string' ? record.ua : null,
  };
}

/**
 * The stored attempts for one counter key, newest first. A connection is opened
 * and closed per call, matching the lockout reader: the panel uses Redis for these
 * screens only, so a pooled client would be state nobody benefits from.
 */
export async function listAttempts(
  url: string,
  counterNamespace: string,
  bucketKey: string,
): Promise<LoginAttempt[]> {
  const client = createClient({ url });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const raw = await client.lRange(attemptListKey(counterNamespace, bucketKey), -LOGIN_ATTEMPT_LIMIT, -1);
    return raw
      .map(parseAttempt)
      .filter((attempt): attempt is LoginAttempt => attempt !== null)
      .reverse();
  } finally {
    await client.quit();
  }
}
