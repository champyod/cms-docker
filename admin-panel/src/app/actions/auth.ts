'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

import bcrypt from 'bcryptjs';

import { createSession, deleteSession, getSession } from '@/lib/auth';
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';
import { getFreshPermissions } from '@/lib/permissions';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { getCaptchaEnv, resolveActiveProvider, verifyCaptcha, type CaptchaProvider } from '@/lib/captcha';
import { getAdminLoginClient, prisma } from '@/lib/prisma';
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
import { buildCaptchaRequiredState, extractCaptchaProvider, extractCaptchaToken, isCaptchaRequiredForIp, shouldRequireCaptcha } from '@/lib/auth-captcha-helpers';
import {
  FORWARDED_TRUST_ENV,
  resolveClientIp,
  resolveForwardedAddress,
} from '@/lib/request-identity';
import type { LoginAttemptContext } from '@/lib/login-attempts';
import { isLoginExempt } from '@/lib/security/exemptions';
import { recordLoginLockout } from '@/lib/security/lockouts';

const DUMMY_BCRYPT_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQz0l8Dp5uJHnKzTKmPqR3sWbGyq';
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

// A dual-stack socket reports ::ffff:127.0.0.1 where a v4-only one reports the bare address.
function isLoopbackIp(ip: string): boolean {
  if (ip === 'local' || ip === '::1') return true;
  const address = ip.startsWith('::ffff:') ? ip.substring('::ffff:'.length) : ip;
  return /^127\./.test(address);
}

// Both buckets are tracked or either protection is bypassed; loopback is exempt because every user shares one address.
async function resolveRequestIdentity(
  username: string,
): Promise<{ readonly bucketKeys: readonly string[]; readonly attempt: LoginAttemptContext }> {
  const requestHeaders = await headers();
  const ip = resolveForwardedAddress(requestHeaders, process.env[FORWARDED_TRUST_ENV]);
  const accountKey = buildAccountBucketKey(username, ip);
  const bucketKeys = isLoopbackIp(ip) ? [accountKey] : [accountKey, buildIpBucketKey(ip)];
  return {
    bucketKeys,
    attempt: {
      ip,
      surfaceKey: 'admin-panel',
      path: loginPathFrom(requestHeaders.get('referer')),
      ua: requestHeaders.get('user-agent'),
    },
  };
}

function loginPathFrom(referer: string | null): string {
  if (referer === null) return '/auth/login';
  try {
    return new URL(referer).pathname;
  } catch {
    return '/auth/login';
  }
}

/** One ledger row per lockout, never per attempt; the counter itself stays in memory. */
async function recordLoginFailure(
  bucketKeys: readonly string[],
  username: string,
  attempt: LoginAttemptContext,
): Promise<void> {
  await recordFailedAttempt(bucketKeys, attempt);
  if (!(await isRateLimited(bucketKeys))) return;
  const ip = bucketKeys[0].split('|')[1] ?? 'local';
  await asAuth(() =>
    recordLoginLockout({ username, ip, expiresAt: new Date(Date.now() + LOGIN_LOCKOUT_MS) }),
  );
}

export async function getCaptchaState(username?: string): Promise<{ required: boolean; enabled: boolean; provider: CaptchaProvider; siteKey: string; threshold: number; banThreshold: number }> {
  const env = getCaptchaEnv();
  // Render path: an unreachable primary must offer the next provider in the chain.
  const active = await resolveActiveProvider(env);
  const configured = env.enabled && active.siteKey.length > 0 && active.secretKey.length > 0;
  if (!configured) return { required: false, enabled: false, provider: active.provider, siteKey: '', threshold: env.threshold, banThreshold: env.banThreshold };
  await pruneExpiredLoginBuckets();
  const ip = await resolveClientIp();
  let required = await isCaptchaRequiredForIp(ip);
  if (!required && username && username.trim().length > 0) required = await shouldRequireCaptcha(`${username.trim()}|${ip}`);
  return { required, enabled: true, provider: active.provider, siteKey: active.siteKey, threshold: env.threshold, banThreshold: env.banThreshold };
}

async function verifyStoredPassword(password: string, stored: string): Promise<boolean> {
  // Admin credentials are bcrypt-only; a plaintext or legacy value never authenticates.
  if (!stored.startsWith(BCRYPT_PREFIX)) return false;
  return bcrypt.compare(password, stored.substring(BCRYPT_PREFIX.length));
}

async function findActiveAdmin(username: string): Promise<AuthenticatedAdmin | null> {
  // Login role: it holds admins.authentication, and there is no fallback to the application connection.
  const client = getAdminLoginClient();
  // system:auth is the only identity admitted before a session exists, and only for credential verification.
  const admin = await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.AUTH }, () =>
    client.admins.findUnique({
      where: { username },
      select: { id: true, username: true, authentication: true, enabled: true },
    }),
  );
  if (!admin || !admin.enabled) return null;
  return admin;
}

/** Pre-session work runs as system:auth, the only identity admitted before a session exists. */
function asAuth<T>(work: () => Promise<T>): Promise<T> {
  return withActor({ kind: 'system', name: SYSTEM_IDENTITIES.AUTH }, work);
}

async function startAdminSession(admin: AuthenticatedAdmin): Promise<void> {
  await createSession(admin.id.toString(), admin.username);
}

async function completeLogin(admin: AuthenticatedAdmin, bucketKeys: readonly string[]): Promise<void> {
  await startAdminSession(admin);
  try {
    await asAuth(() =>
      prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } }),
    );
  } catch (error) {
    console.error('Could not record the last login time:', error);
  }
  await clearBucket(bucketKeys);
}

// Signing in is its own permission, and a refusal reads exactly like a wrong password.
async function maySignIn(admin: AuthenticatedAdmin): Promise<boolean> {
  const permissions = await asAuth(() => getFreshPermissions(admin.id.toString()));
  return permissions !== null && hasEffectivePermission(permissions, 'admin:login');
}

async function refuseLogin(
  bucketKeys: readonly string[],
  username: string,
  exempt: boolean,
  attempt: LoginAttemptContext,
): Promise<LoginActionState> {
  // An exempt identity is neither counted nor challenged, so a wrong password cannot re-arm a counter.
  if (!exempt) await recordLoginFailure(bucketKeys, username, attempt);
  const nextState: LoginActionState = { error: 'Invalid credentials' };
  if (!exempt && (await shouldRequireCaptcha(bucketKeys[0]))) Object.assign(nextState, buildCaptchaRequiredState());
  return nextState;
}

export async function login(_prevState: LoginActionState | null, formData: FormData): Promise<LoginActionState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!username || !password) return { error: 'Username and password are required' };
  const { bucketKeys, attempt } = await resolveRequestIdentity(username);
  // Checked before every gate: a lift that only cleared the counters could be re-earned.
  const clientIp = await resolveClientIp();
  const exempt = await asAuth(() => isLoginExempt(username, clientIp));
  if (!exempt) {
    await pruneExpiredLoginBuckets();
    if (await isRateLimited(bucketKeys)) return { success: false, error: 'Too many attempts. Try again later.', ...buildCaptchaRequiredState() };
    if (await shouldRequireCaptcha(bucketKeys[0])) {
      const token = extractCaptchaToken(formData);
      if (!token) return { success: false, error: 'CAPTCHA verification required', ...buildCaptchaRequiredState() };
      const valid = await verifyCaptcha(token, extractCaptchaProvider(formData));
      if (!valid) return { success: false, error: 'CAPTCHA verification failed', ...buildCaptchaRequiredState() };
    }
  }
  try {
    const admin = await findActiveAdmin(username);
    if (!admin) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return refuseLogin(bucketKeys, username, exempt, attempt);
    }
    if (!(await verifyStoredPassword(password, admin.authentication))) {
      return refuseLogin(bucketKeys, username, exempt, attempt);
    }
    if (!(await maySignIn(admin))) {
      return refuseLogin(bucketKeys, username, exempt, attempt);
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
