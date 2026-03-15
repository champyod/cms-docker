import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "crypto";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const secretKey = (() => {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  console.warn("WARNING: AUTH_SECRET is not set. Using a random secret — sessions will not persist across restarts.");
  return crypto.randomBytes(32).toString("hex");
})();
const key = new TextEncoder().encode(secretKey);

// COOKIE_SECURE=true only if explicitly set — defaults false so HTTP access works
const isSecureCookie = process.env.COOKIE_SECURE === 'true';

export async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function decrypt(input: string): Promise<any> {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload;
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

export async function createSession(userId: string, username: string, permissions: {
  permission_all: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
  permission_messaging: boolean;
}) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const session = await encrypt({ userId, username, permissions, expiresAt });
  (await cookies()).set("session", session, buildCookieOptions(expiresAt));
}

export async function refreshSession(payload: any) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const { userId, username, permissions } = payload;
  const session = await encrypt({ userId, username, permissions, expiresAt });
  try {
    (await cookies()).set("session", session, buildCookieOptions(expiresAt));
  } catch {
    // cookies() may throw in read-only render contexts — safe to ignore
  }
}

export async function deleteSession() {
  (await cookies()).delete("session");
}

export async function getSession() {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt(session);
  } catch {
    return null;
  }
}
