import crypto from 'crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';

/**
 * The session cookie: its name, the key that signs it, and the two operations on it.
 *
 * WHY this is its own module and not part of `auth.ts`: `auth.ts` reads the admin table to check
 * liveness, and a read needs a database actor — which is derived from this cookie. Keeping the
 * cookie entirely DB-free breaks that cycle: `db-actor.ts` imports this, `auth.ts` imports this and
 * the access layer, and neither reaches back into the other.
 *
 * The secret is created once, here. Two modules each generating their own random fallback would
 * sign and verify with different keys on a host with no AUTH_SECRET, and every session would read
 * as invalid the moment the two modules disagreed about who owned the cookie.
 */

// Why: use 7-day session cookie but 2-hour JWT expiry so the session has to be re-signed on a timer
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Why: tokens hard-expire at 2h, so re-signing at half that age always leaves a presented
// token more than half its life remaining while still sliding the 7-day cookie window
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

// Why the name is configurable: two panels on one host — a /beta deployment beside the root one —
// share a cookie namespace, and a name only one of them writes is what keeps their sessions apart.
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || 'session';

// Why: a clear must repeat the path the cookie was written with. Without it the browser
// scopes the expiring cookie to the request directory and keeps the original session alive
export const SESSION_COOKIE_PATH = '/';

const secretKey = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  console.warn('WARNING: AUTH_SECRET is not set. Using a random secret — sessions will not persist across restarts.');
  return crypto.randomBytes(32).toString('hex');
})();
const key = new TextEncoder().encode(secretKey);

export interface SessionPayload {
  userId: string;
  username: string;
  expiresAt: string | Date;
}

export type SessionClaims = SessionPayload & { readonly iat?: number };

/** Signs a payload as an HS256 JWT with a fixed 2h expiry (short-lived by design; sessions refresh via slideSessionCookie). */
export async function encrypt<T extends JWTPayload>(payload: T): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key);
}

/** Verifies signature/expiry and returns the decoded payload; callers re-validate shape before trusting fields. */
export async function decrypt<T = unknown>(input: string): Promise<T> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ['HS256'],
  });
  return payload as T;
}

/** Verifies a token, returning null for a bad signature or a past expiry. */
export async function readSessionClaims(token: string): Promise<SessionClaims | null> {
  try {
    return await decrypt<SessionClaims>(token);
  } catch {
    // Bad signature or past exp — the caller decides whether that means clearing the cookie
    return null;
  }
}

/**
 * The claims of the cookie on the request in flight, or null.
 *
 * WHY every failure is null: outside a request (a CLI run, a test, a background job) `cookies()`
 * throws, and inside one it returns an empty jar — both mean "no session here", which is exactly
 * what the caller needs to distinguish from a broken one. This function never has an opinion about
 * whether a database actor exists; that is `db-actor.ts`'s decision and its error to raise.
 */
export async function readSessionClaimsFromCookies(): Promise<SessionClaims | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return null;
  }
  if (!token) return null;
  return await readSessionClaims(token);
}
