'use server';

import { prisma } from "@/lib/prisma";
import { createSession, deleteSession, getSession } from "@/lib/auth";
import { redirect } from "@/lib/redirect";
import { safeAdminSelect, type SafeAdmin } from "@/lib/prisma-selects";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getCaptchaEnv, getCaptchaPublicConfig, isCaptchaConfigured, verifyCaptcha, type CaptchaProvider } from "@/lib/captcha";

const DUMMY_BCRYPT_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQz0l8Dp5uJHnKzTKmPqR3sWbGyq';
const PLAINTEXT_PREFIX = 'plaintext:';
const BCRYPT_PREFIX = 'bcrypt:';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOGIN_BUCKETS = 1000;

export interface LoginActionState {
  error?: string;
  success?: boolean;
  captchaRequired?: boolean;
  captchaProvider?: CaptchaProvider;
  captchaSiteKey?: string;
}

interface AuthenticatedAdmin {
  id: number;
  username: string;
  authentication: string;
  permission_all: boolean;
  permission_tasks: boolean;
  permission_users: boolean;
  permission_contests: boolean;
  permission_messaging: boolean;
}

const loginBuckets = new Map<string, { count: number; resetAt: number }>();

function evictOldestLoginBucket(): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  for (const [key, entry] of loginBuckets) {
    if (entry.resetAt < oldestResetAt) {
      oldestResetAt = entry.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    loginBuckets.delete(oldestKey);
  }
}

function enforceBucketLimit(): void {
  if (loginBuckets.size >= MAX_LOGIN_BUCKETS) {
    evictOldestLoginBucket();
  }
}

function pruneExpiredLoginBuckets(): void {
  for (const [key, entry] of loginBuckets) {
    if (Date.now() >= entry.resetAt) {
      loginBuckets.delete(key);
    }
  }
}

function isRateLimited(bucketKey: string): boolean {
  const bucket = loginBuckets.get(bucketKey);
  return bucket !== undefined && bucket.count >= MAX_LOGIN_ATTEMPTS && Date.now() < bucket.resetAt;
}

function recordFailedAttempt(bucketKey: string): void {
  const failed = loginBuckets.get(bucketKey) ?? { count: 0, resetAt: 0 };
  failed.count += 1;
  failed.resetAt = Date.now() + LOGIN_LOCKOUT_MS;
  loginBuckets.set(bucketKey, failed);
  enforceBucketLimit();
}

async function resolveBucketKey(username: string): Promise<string> {
  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return `${username}|${ip}`;
}

async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

function getCaptchaThreshold(): number {
  return getCaptchaEnv().threshold;
}

function shouldRequireCaptcha(bucketKey: string): boolean {
  if (!isCaptchaConfigured()) return false;
  const bucket = loginBuckets.get(bucketKey);
  if (!bucket) return false;
  if (Date.now() >= bucket.resetAt) return false;
  return bucket.count >= getCaptchaThreshold();
}

function isCaptchaRequiredForIp(ip: string): boolean {
  if (!isCaptchaConfigured()) return false;
  const threshold = getCaptchaThreshold();
  for (const [key, bucket] of loginBuckets) {
    if (!key.endsWith(`|${ip}`)) continue;
    if (Date.now() >= bucket.resetAt) continue;
    if (bucket.count >= threshold) return true;
  }
  return false;
}

function buildCaptchaRequiredState(): Pick<LoginActionState, "captchaRequired" | "captchaProvider" | "captchaSiteKey"> {
  const pub = getCaptchaPublicConfig();
  if (!pub.enabled) return { captchaRequired: true };
  return { captchaRequired: true, captchaProvider: pub.provider, captchaSiteKey: pub.siteKey };
}

function extractCaptchaToken(formData: FormData): string {
  const candidates = [
    formData.get("captchaToken"),
    formData.get("cf-turnstile-response"),
    formData.get("h-captcha-response"),
    formData.get("g-recaptcha-response"),
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

export async function getCaptchaState(username?: string): Promise<{
  required: boolean;
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  threshold: number;
  banThreshold: number;
}> {
  const env = getCaptchaEnv();
  const pub = getCaptchaPublicConfig();
  if (!pub.enabled) {
    return { required: false, enabled: false, provider: pub.provider, siteKey: "", threshold: env.threshold, banThreshold: env.banThreshold };
  }
  pruneExpiredLoginBuckets();
  const ip = await resolveClientIp();
  let required = isCaptchaRequiredForIp(ip);
  if (!required && username && username.trim().length > 0) {
    const bucketKey = `${username.trim()}|${ip}`;
    required = shouldRequireCaptcha(bucketKey);
  }
  return { required, enabled: true, provider: pub.provider, siteKey: pub.siteKey, threshold: env.threshold, banThreshold: env.banThreshold };
}

function verifyPlaintextPassword(password: string, stored: string): boolean {
  const expected = stored.substring(PLAINTEXT_PREFIX.length);
  const actualBytes = Buffer.from(password);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

async function verifyStoredPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return verifyPlaintextPassword(password, stored);
  }
  const hash = stored.startsWith(BCRYPT_PREFIX) ? stored.substring(BCRYPT_PREFIX.length) : stored;
  return bcrypt.compare(password, hash);
}

async function findActiveAdmin(username: string): Promise<AuthenticatedAdmin | null> {
  const admin = await prisma.admins.findUnique({ where: { username } });
  if (!admin || !admin.enabled) return null;
  return admin;
}

async function startAdminSession(admin: AuthenticatedAdmin): Promise<void> {
  await createSession(admin.id.toString(), admin.username, {
    permission_all: admin.permission_all,
    permission_tasks: admin.permission_tasks,
    permission_users: admin.permission_users,
    permission_contests: admin.permission_contests,
    permission_messaging: admin.permission_messaging,
  });
}

async function completeLogin(admin: AuthenticatedAdmin, bucketKey: string): Promise<void> {
  await startAdminSession(admin);

  // last_login_at is best-effort telemetry — a failed write must never block an authenticated login
  try {
    await prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
  } catch {
  }

  loginBuckets.delete(bucketKey);
  enforceBucketLimit();
}

export async function login(_prevState: LoginActionState | null, formData: FormData): Promise<LoginActionState> {
  const username = String(formData.get("username") ?? '');
  const password = String(formData.get("password") ?? '');

  if (!username || !password) {
    return { error: "Username and password are required" };
  }

  const bucketKey = await resolveBucketKey(username);
  pruneExpiredLoginBuckets();
  if (isRateLimited(bucketKey)) {
    const captchaState = buildCaptchaRequiredState();
    return { success: false, error: 'Too many attempts. Try again later.', ...captchaState };
  }

  if (shouldRequireCaptcha(bucketKey)) {
    const token = extractCaptchaToken(formData);
    if (!token) {
      return { success: false, error: "CAPTCHA verification required", ...buildCaptchaRequiredState() };
    }
    const valid = await verifyCaptcha(token);
    if (!valid) {
      return { success: false, error: "CAPTCHA verification failed", ...buildCaptchaRequiredState() };
    }
  }

  try {
    const admin = await findActiveAdmin(username);
    if (!admin) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      recordFailedAttempt(bucketKey);
      const nextState: LoginActionState = { error: "Invalid credentials" };
      if (shouldRequireCaptcha(bucketKey)) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }

    if (!(await verifyStoredPassword(password, admin.authentication))) {
      recordFailedAttempt(bucketKey);
      const nextState: LoginActionState = { error: "Invalid credentials" };
      if (shouldRequireCaptcha(bucketKey)) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }

    await completeLogin(admin, bucketKey);
  } catch (error) {
    console.error("Login error:", error);
    return { error: "An unexpected error occurred" };
  }

  revalidatePath("/");
  return redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  await redirect("/auth/login");
}

export async function getCurrentUser(): Promise<SafeAdmin | null> {
  const session = await getSession();
  if (!session?.userId) return null;

  const id = parseInt(session.userId);
  if (isNaN(id)) return null;

  return prisma.admins.findUnique({
    where: { id },
    select: { ...safeAdminSelect },
  });
}
