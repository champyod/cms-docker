import "server-only";

export type CaptchaProvider = "turnstile" | "hcaptcha";

export interface CaptchaEnv {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  secretKey: string;
  threshold: number;
  banThreshold: number;
}

export interface CaptchaPublicConfig {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
}

function parseThreshold(raw: string | undefined, fallback: number): number {
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseProvider(raw: string | undefined): CaptchaProvider {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "hcaptcha") return "hcaptcha";
  return "turnstile";
}

export function getCaptchaEnv(): CaptchaEnv {
  const enabledRaw = process.env.CAPTCHA_ENABLED?.trim();
  const enabled = enabledRaw === "1" || enabledRaw?.toLowerCase() === "true";
  const provider = parseProvider(process.env.CAPTCHA_PROVIDER);
  const siteKey = process.env.CAPTCHA_SITE_KEY?.trim() ?? "";
  const secretKey = process.env.CAPTCHA_SECRET_KEY?.trim() ?? "";
  const threshold = parseThreshold(process.env.CAPTCHA_THRESHOLD, 3);
  const banThreshold = parseThreshold(process.env.CAPTCHA_BAN_THRESHOLD, 5);
  return { enabled, provider, siteKey, secretKey, threshold, banThreshold };
}

export function isCaptchaConfigured(): boolean {
  const env = getCaptchaEnv();
  return env.enabled && env.siteKey.length > 0 && env.secretKey.length > 0;
}

export function getCaptchaPublicConfig(): CaptchaPublicConfig {
  const env = getCaptchaEnv();
  const configured = isCaptchaConfigured();
  return {
    enabled: configured,
    provider: env.provider,
    siteKey: configured ? env.siteKey : "",
  };
}

export async function verifyCaptcha(token: string): Promise<boolean> {
  const env = getCaptchaEnv();

  if (!env.enabled || env.siteKey.length === 0 || env.secretKey.length === 0) {
    return true;
  }

  if (!token || token.trim().length === 0) {
    return false;
  }

  const trimmed = token.trim();

  try {
    if (env.provider === "hcaptcha") {
      return await verifyHCaptcha(trimmed, env.secretKey);
    }
    return await verifyTurnstile(trimmed, env.secretKey);
  } catch {
    return false;
  }
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}

async function verifyHCaptcha(token: string, secret: string): Promise<boolean> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const response = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}
