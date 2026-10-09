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
import {
  LOGIN_LOCKOUT_MS,
  buildAccountBucketKey,
  buildIpBucketKey,
  clearBucket,
  isRateLimited,
  pruneExpiredLoginBuckets,
  recordFailedAttempt,
} from '@/lib/auth-rate-limit';
import { buildCaptchaRequiredState, extractCaptchaToken, isCaptchaRequiredForIp, shouldRequireCaptcha } from '@/lib/auth-captcha-helpers';
import { recordLoginLockout } from '@/lib/security/lockouts';

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
}

async function resolveClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

// A dual-stack socket hands back `::ffff:127.0.0.1` where a v4-only one reports
// the bare address, so the prefix is stripped before the v4 test rather than
// being tested for twice.
function isLoopbackIp(ip: string): boolean {
  if (ip === 'local' || ip === '::1') return true;
  const address = ip.startsWith('::ffff:') ? ip.substring('::ffff:'.length) : ip;
  return /^127\./.test(address);
}

// The username bucket keeps one attacker to one account from exhausting every
// bucket, while the IP bucket stops the same source from resetting its counter
// by rotating usernames. Both families must be tracked or either protection is
// trivially bypassed. Loopback is the one exception: funnel, tailscale serve and
// direct local access all present the same address to every user, so an IP
// bucket there would be one shared counter that locks out unrelated accounts.
async function resolveBucketKeys(username: string): Promise<readonly string[]> {
  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const accountKey = buildAccountBucketKey(username, ip);
  if (isLoopbackIp(ip)) return [accountKey];
  return [accountKey, buildIpBucketKey(ip)];
}

/** One ledger row per lockout, never per attempt; the counter itself stays in memory. */
async function recordLoginFailure(bucketKeys: readonly string[], username: string): Promise<void> {
  recordFailedAttempt(bucketKeys);
  if (!isRateLimited(bucketKeys)) return;
  const ip = bucketKeys[0].split('|')[1] ?? 'local';
  await recordLoginLockout({ username, ip, expiresAt: new Date(Date.now() + LOGIN_LOCKOUT_MS) });
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
  await createSession(admin.id.toString(), admin.username);
}

async function completeLogin(admin: AuthenticatedAdmin, bucketKeys: readonly string[]): Promise<void> {
  await startAdminSession(admin);
  try {
    await prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
  } catch {
  }
  clearBucket(bucketKeys);
}

export async function login(_prevState: LoginActionState | null, formData: FormData): Promise<LoginActionState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!username || !password) return { error: 'Username and password are required' };
  const bucketKeys = await resolveBucketKeys(username);
  pruneExpiredLoginBuckets();
  if (isRateLimited(bucketKeys)) return { success: false, error: 'Too many attempts. Try again later.', ...buildCaptchaRequiredState() };
  if (shouldRequireCaptcha(bucketKeys[0])) {
    const token = extractCaptchaToken(formData);
    if (!token) return { success: false, error: 'CAPTCHA verification required', ...buildCaptchaRequiredState() };
    const valid = await verifyCaptcha(token);
    if (!valid) return { success: false, error: 'CAPTCHA verification failed', ...buildCaptchaRequiredState() };
  }
  try {
    const admin = await findActiveAdmin(username);
    if (!admin) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await recordLoginFailure(bucketKeys, username);
      const nextState: LoginActionState = { error: 'Invalid credentials' };
      if (shouldRequireCaptcha(bucketKeys[0])) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }
    if (!(await verifyStoredPassword(password, admin.authentication))) {
      await recordLoginFailure(bucketKeys, username);
      const nextState: LoginActionState = { error: 'Invalid credentials' };
      if (shouldRequireCaptcha(bucketKeys[0])) Object.assign(nextState, buildCaptchaRequiredState());
      return nextState;
    }
    await completeLogin(admin, bucketKeys);
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
