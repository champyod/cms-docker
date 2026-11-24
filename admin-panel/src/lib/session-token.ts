import crypto from 'crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
/* next/headers is imported lazily: the Prisma client is loaded by processes that are not requests. */

/** DB-free on purpose: db-actor derives from this cookie and auth.ts reads the admin table, so the cycle breaks here. */

// Why: use 7-day session cookie but 2-hour JWT expiry so the session has to be re-signed on a timer
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Re-signing at half the hard-expiry age always leaves more than half the token's life remaining.
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

// Two panels on one host share a cookie namespace; the name keeps their sessions apart.
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || 'session';

// A clear must repeat the path the cookie was written with, or the browser keeps the original alive.
export const SESSION_COOKIE_PATH = '/';

const secretKey = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  console.warn('WARNING: AUTH_SECRET is not set. Using a random secret: sessions will not persist across restarts.');
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

/** Outside a request cookies() throws and inside one it returns an empty jar; both mean no session here. */
export async function readSessionClaimsFromCookies(): Promise<SessionClaims | null> {
  let token: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return null;
  }
  if (!token) return null;
  return await readSessionClaims(token);
}
