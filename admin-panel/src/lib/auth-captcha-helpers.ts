import { getCaptchaEnv, getCaptchaPublicConfig, isCaptchaConfigured, type CaptchaProvider } from '@/lib/captcha';
import { loginBuckets } from '@/lib/auth-rate-limit';
import type { LoginActionState } from '@/app/actions/auth';

export function getCaptchaThreshold(): number {
  return getCaptchaEnv().threshold;
}

export function shouldRequireCaptcha(bucketKey: string): boolean {
  if (!isCaptchaConfigured()) return false;
  const bucket = loginBuckets.get(bucketKey);
  if (!bucket) return false;
  if (Date.now() >= bucket.resetAt) return false;
  return bucket.count >= getCaptchaThreshold();
}

export function isCaptchaRequiredForIp(ip: string): boolean {
  if (!isCaptchaConfigured()) return false;
  const threshold = getCaptchaThreshold();
  for (const [key, bucket] of loginBuckets) {
    if (!key.endsWith(`|${ip}`)) continue;
    if (Date.now() >= bucket.resetAt) continue;
    if (bucket.count >= threshold) return true;
  }
  return false;
}

export function buildCaptchaRequiredState(): Pick<LoginActionState, 'captchaRequired' | 'captchaProvider' | 'captchaSiteKey'> {
  const pub = getCaptchaPublicConfig();
  if (!pub.enabled) return { captchaRequired: true };
  return { captchaRequired: true, captchaProvider: pub.provider, captchaSiteKey: pub.siteKey };
}

export function extractCaptchaToken(formData: FormData): string {
  const candidates = [formData.get('captchaToken'), formData.get('cf-turnstile-response'), formData.get('h-captcha-response'), formData.get('g-recaptcha-response')];
  for (const value of candidates) if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return '';
}
