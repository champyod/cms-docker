import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Why: use 7-day session cookie but 2-hour JWT expiry so refreshSession must validate liveness on each request
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Signs a payload as an HS256 JWT with a fixed 2h expiry (short-lived by design; sessions refresh via refreshSession). */
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
    path: "/",
  };
}

export async function createSession(userId: string, username: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({ userId, username, expiresAt });
  (await cookies()).set("session", session, buildCookieOptions(expiresAt));
}

export async function refreshSession(payload: SessionPayload): Promise<string | null> {
  let admin;
  try {
    admin = await prisma.admins.findUnique({
      where: { id: Number.parseInt(payload.userId, 10) },
      select: { username: true, enabled: true },
    });
  } catch {
    // DB unavailable — fail closed, keep existing cookie untouched
    return null;
  }

  if (!admin || !admin.enabled) {
    try {
      (await cookies()).delete("session");
    } catch {
      // cookies() may throw in read-only render contexts — safe to ignore
    }
    return null;
  }

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({
    userId: payload.userId,
    username: admin.username,
    expiresAt,
  });

  try {
    (await cookies()).set("session", session, buildCookieOptions(expiresAt));
  } catch {
    // cookies() may throw in read-only render contexts — safe to ignore
  }
  return session;
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete("session");
}

export async function getSession(): Promise<SessionPayload | null> {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt<SessionPayload>(session);
  } catch {
    return null;
  }
}
