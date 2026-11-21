import { getCaptchaEnv, getCaptchaPublicConfig, isCaptchaConfigured } from '@/lib/captcha';
import { buildIpBucketKey, bucketAtOrAbove } from '@/lib/auth-rate-limit';
import type { LoginActionState } from '@/app/actions/auth';

export function getCaptchaThreshold(): number {
  return getCaptchaEnv().threshold;
}

export async function shouldRequireCaptcha(bucketKey: string): Promise<boolean> {
  if (!isCaptchaConfigured()) return false;
  return bucketAtOrAbove(bucketKey, getCaptchaThreshold());
}

export async function isCaptchaRequiredForIp(ip: string): Promise<boolean> {
  if (!isCaptchaConfigured()) return false;
  // The per-address bucket is what names an address with no username yet; a
  // loopback address has none, so its challenge comes from the posted username.
  return bucketAtOrAbove(buildIpBucketKey(ip), getCaptchaThreshold());
}

export function buildCaptchaRequiredState(): Pick<LoginActionState, 'captchaRequired' | 'captchaProvider' | 'captchaSiteKey'> {
  const pub = getCaptchaPublicConfig();
  if (!pub.enabled) return { captchaRequired: true };
  return { captchaRequired: true, captchaProvider: pub.provider, captchaSiteKey: pub.siteKey };
}

export function extractCaptchaProvider(formData: FormData): string {
  const value = formData.get('captchaProvider');
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function extractCaptchaToken(formData: FormData): string {
  const candidates = [formData.get('captchaToken'), formData.get('cf-turnstile-response'), formData.get('h-captcha-response'), formData.get('g-recaptcha-response')];
  for (const value of candidates) if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return '';
}
