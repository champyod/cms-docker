'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { createSession, deleteSession, getSession } from '@/lib/auth';
import { getCaptchaEnv, getCaptchaPublicConfig, verifyCaptcha, type CaptchaProvider } from '@/lib/captcha';
import { prisma } from '@/lib/prisma';
import { safeAdminSelect, type SafeAdmin } from '@/lib/prisma-selects';
import { redirect } from '@/lib/redirect';
import { clearBucket, isRateLimited, loginBuckets, pruneExpiredLoginBuckets, recordFailedAttempt } from '@/lib/auth-rate-limit';
import { buildCaptchaRequiredState, extractCaptchaToken, isCaptchaRequiredForIp, shouldRequireCaptcha } from '@/lib/auth-captcha-helpers';

const DUMMY_BCRYPT_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQz0l8Dp5uJHnKzTKmPqR3sWbGyq';
const PLAINTEXT_PREFIX = 'plaintext:';
const BCRYPT_PREFIX = 'bcrypt:';

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

async function resolveBucketKey(username: string): Promise<string> {
  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return `${username}|${ip}`;
}

async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export async function getCaptchaState(username?: string): Promise<{ required: boolean; enabled: boolean; provider: CaptchaProvider; siteKey: string; threshold: number; banThreshold: number }> {
  const env = getCaptchaEnv();
  const pub = getCaptchaPublicConfig();
  if (!pub.enabled) return { required: false, enabled: false, provider: pub.provider, siteKey: '', threshold: env.threshold, banThreshold: env.banThreshold };
  pruneExpiredLoginBuckets();
  const ip = await resolveClientIp();
  let required = isCaptchaRequiredForIp(ip);
  if (!required && username && username.trim().length > 0) required = shouldRequireCaptcha(`${username.trim()}|${ip}`);
  return { required, enabled: true, provider: pub.provider, siteKey: pub.siteKey, threshold: env.threshold, banThreshold: env.banThreshold };
}

function verifyPlaintextPassword(password: string, stored: string): boolean {
  const expected = stored.substring(PLAINTEXT_PREFIX.length);
  const actualBytes = Buffer.from(password);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

async function verifyStoredPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PLAINTEXT_PREFIX)) return verifyPlaintextPassword(password, stored);
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
  try {
    await prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
  } catch {
  }
  clearBucket(bucketKey);
}

export async function login(_prevState: LoginActionState | null, formData: FormData): Promise<LoginActionState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!username || !password) return { error: 'Username and password are required' };
  const bucketKey = await resolveBucketKey(username);
  pruneExpiredLoginBuckets();
  if (isRateLimited(bucketKey)) return { success: false, error: 'Too many attempts. Try again later.', ...buildCaptchaRequiredState() };
  if (shouldRequireCaptcha(bucketKey)) {
    const token = extractCaptchaToken(formData);
    if (!token) return { success: false, error: 'CAPTCHA verification required', ...buildCaptchaRequiredState() };
    const valid = await verifyCaptcha(token);
    if (!valid) return { success: false, error: 'CAPTCHA verification failed', ...buildCaptchaRequiredState() };
  }
  try {
    const admin = await findActiveAdmin(username);
    if (!admin) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      recordFailedAttempt(bucketKey);
      const nextState: LoginActionState = { error: 'Invalid credentials' };
      if (shouldRequireCaptcha(bucketKey)) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }
    if (!(await verifyStoredPassword(password, admin.authentication))) {
      recordFailedAttempt(bucketKey);
      const nextState: LoginActionState = { error: 'Invalid credentials' };
      if (shouldRequireCaptcha(bucketKey)) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }
    await completeLogin(admin, bucketKey);
  } catch (error) {
    console.error('Login error:', error);
    return { error: 'An unexpected error occurred' };
  }
  revalidatePath('/');
  return redirect('/');
}

export async function logout(): Promise<void> {
  await deleteSession();
  await redirect('/auth/login');
}

export async function getCurrentUser(): Promise<SafeAdmin | null> {
  const session = await getSession();
  if (!session?.userId) return null;
  const id = parseInt(session.userId);
  if (isNaN(id)) return null;
  return prisma.admins.findUnique({ where: { id }, select: { ...safeAdminSelect } });
}
