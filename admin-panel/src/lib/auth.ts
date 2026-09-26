import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Why: use 7-day session cookie but 2-hour JWT expiry so the session has to be re-signed on a timer
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Why: tokens hard-expire at 2h, so re-signing at half that age always leaves a presented
// token more than half its life remaining while still sliding the 7-day cookie window
const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

const SESSION_COOKIE_NAME = "session";

// Why: a clear must repeat the path the cookie was written with. Without it the browser
// scopes the expiring cookie to the request directory and keeps the original session alive
const SESSION_COOKIE_PATH = "/";

const secretKey = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  console.warn("WARNING: AUTH_SECRET is not set. Using a random secret — sessions will not persist across restarts.");
  return crypto.randomBytes(32).toString("hex");
})();
const key = new TextEncoder().encode(secretKey);

// COOKIE_SECURE=true only if explicitly set — defaults false so HTTP access works
const isSecureCookie = process.env.COOKIE_SECURE === 'true';

// Why: permissions are resolved per request via getFreshPermissions, never stored on the token,
// so a re-signed session cannot carry stale grants.
export interface SessionPayload {
  userId: string;
  username: string;
  expiresAt: string | Date;
}

/** Signs a payload as an HS256 JWT with a fixed 2h expiry (short-lived by design; sessions refresh via slideSessionCookie). */
export async function encrypt<T extends JWTPayload>(payload: T): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(key);
}

/** Verifies signature/expiry and returns the decoded payload; callers re-validate shape before trusting fields. */
export async function decrypt<T = unknown>(input: string): Promise<T> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload as T;
}

function buildCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: isSecureCookie,
    expires: expiresAt,
    sameSite: "lax" as const,
    path: SESSION_COOKIE_PATH,
  };
}

export async function createSession(userId: string, username: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({ userId, username, expiresAt });
  (await cookies()).set(SESSION_COOKIE_NAME, session, buildCookieOptions(expiresAt));
}

type AdminLiveness = {
  readonly isEnabled: boolean;
  readonly username: string;
};

/**
 * Liveness verdict for the admin behind a session. The active branch carries the current
 * username so a caller that re-signs picks up a rename without querying twice.
 */
export type SessionStatus =
  | { readonly state: "active"; readonly username: string }
  | { readonly state: "revoked" }
  | { readonly state: "unreachable" };

async function findAdminLiveness(userId: string): Promise<AdminLiveness | null> {
  try {
    const admin = await prisma.admins.findUnique({
      where: { id: Number.parseInt(userId, 10) },
      select: { username: true, enabled: true },
    });
    if (!admin) return { isEnabled: false, username: "" };
    return { isEnabled: admin.enabled, username: admin.username };
  } catch {
    // Database unreachable — reported as its own state so callers fail the request closed
    // but leave the cookie alone, otherwise a transient outage signs every admin out
    return null;
  }
}

/**
 * Read-only session liveness check. It never touches cookies, so the render phase can call
 * it where a write would throw; slideSessionCookie owns every mutation.
 */
export async function readSessionStatus(userId: string): Promise<SessionStatus> {
  const liveness = await findAdminLiveness(userId);
  if (liveness === null) return { state: "unreachable" };
  if (!liveness.isEnabled) return { state: "revoked" };
  return { state: "active", username: liveness.username };
}

type SessionClaims = SessionPayload & { readonly iat?: number };

async function readSessionClaims(token: string): Promise<SessionClaims | null> {
  try {
    return await decrypt<SessionClaims>(token);
  } catch {
    // Bad signature or past exp — the caller decides whether that means clearing the cookie
    return null;
  }
}

function isRefreshDue(claims: SessionClaims): boolean {
  if (claims.iat === undefined) return true;
  return Date.now() - claims.iat * 1000 >= SESSION_REFRESH_INTERVAL_MS;
}

function clearSessionCookie(response: NextResponse): void {
  response.cookies.delete({ name: SESSION_COOKIE_NAME, path: SESSION_COOKIE_PATH });
}

/**
 * Slides the session cookie forward on a proxy response. Proxy is the only per-request
 * context that can emit Set-Cookie, so it carries every write and re-signing; rendering
 * stays read-only. Expired or revoked sessions are cleared here because the render path
 * redirects instead of writing.
 */
export async function slideSessionCookie(
  request: NextRequest,
  response: NextResponse
): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return;

  const claims = await readSessionClaims(token);
  if (!claims) {
    clearSessionCookie(response);
    return;
  }
  if (!isRefreshDue(claims)) return;

  const status = await readSessionStatus(claims.userId);
  if (status.state === "revoked") {
    clearSessionCookie(response);
    return;
  }
  if (status.state === "unreachable") return;

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({
    userId: claims.userId,
    username: status.username,
    expiresAt,
  });
  response.cookies.set(SESSION_COOKIE_NAME, session, buildCookieOptions(expiresAt));
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE_NAME, path: SESSION_COOKIE_PATH });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return await readSessionClaims(token);
}
