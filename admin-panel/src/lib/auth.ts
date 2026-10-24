import type { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";

import { withActor, SYSTEM_IDENTITIES } from "@/lib/db-actor";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_DURATION_MS,
  SESSION_REFRESH_INTERVAL_MS,
  decrypt,
  encrypt,
  readSessionClaims,
  type SessionClaims,
  type SessionPayload,
} from "@/lib/session-token";

/**
 * Session handling. The cookie itself — its name, signing key and the two JWT operations — lives in
 * `./session-token` so that reading it never has to import the database layer; that is what lets
 * `./db-actor` derive the actor for a request from the same cookie without a cycle. Everything
 * here adds what needs the database: liveness, sliding, clearing.
 */

// Why re-exported: `./session-token` is an implementation detail of this pair of modules, and
// every caller in the app already imports these names from here.
export { encrypt, decrypt };
export type { SessionPayload };

// COOKIE_SECURE=true only if explicitly set — defaults false so HTTP access works
const isSecureCookie = process.env.COOKIE_SECURE === 'true';

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
    // WHY system:auth: this read is the session-liveness check itself, so it runs while the session
    // is still unproven — that is the definition of the pre-session identity. `admins` is the one
    // table whose policy admits it (AUTH_BOOTSTRAP in the generator), and nothing else may use it.
    const admin = await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.AUTH }, () =>
      prisma.admins.findUnique({
        where: { id: Number.parseInt(userId, 10) },
        select: { username: true, enabled: true },
      }),
    );
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

const SESSION_ID_FINGERPRINT_LENGTH = 16;

/**
 * A stable, non-reversible fingerprint of the session cookie, for correlating
 * audit rows to one session without storing the token itself.
 */
export async function getSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined) return null;
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, SESSION_ID_FINGERPRINT_LENGTH);
}
