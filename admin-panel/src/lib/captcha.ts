import "server-only";

import { isProviderHealthy, recordProviderFailure, recordProviderSuccess } from "@/lib/captcha-health";

export type CaptchaProvider = "turnstile" | "hcaptcha" | "recaptcha";

export const CAPTCHA_PROVIDERS: readonly CaptchaProvider[] = ["turnstile", "hcaptcha", "recaptcha"];

export interface CaptchaKeyPair {
  siteKey: string;
  secretKey: string;
}

export interface CaptchaEnv {
  enabled: boolean;
  providers: readonly CaptchaProvider[];
  keys: Partial<Record<CaptchaProvider, CaptchaKeyPair>>;
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

function parseProvider(raw: string | undefined): CaptchaProvider | null {
  const normalized = raw?.trim().toLowerCase();
  return CAPTCHA_PROVIDERS.find((provider) => provider === normalized) ?? null;
}

function parseChain(raw: string | undefined): CaptchaProvider[] {
  const chain: CaptchaProvider[] = [];
  for (const part of (raw ?? "").split(",")) {
    const provider = parseProvider(part);
    if (provider !== null && !chain.includes(provider)) chain.push(provider);
  }
  return chain;
}

function envName(provider: CaptchaProvider, suffix: "SITE_KEY" | "SECRET_KEY"): string {
  return `CAPTCHA_${provider.toUpperCase()}_${suffix}`;
}

function readKeyPair(provider: CaptchaProvider, legacy: CaptchaProvider): CaptchaKeyPair {
  const siteKey = process.env[envName(provider, "SITE_KEY")]?.trim();
  const secretKey = process.env[envName(provider, "SECRET_KEY")]?.trim();
  if (siteKey || secretKey) return { siteKey: siteKey ?? "", secretKey: secretKey ?? "" };
  // WHY the fallback: a deployment that still sets only the legacy scalar keys
  // must keep working; they stand in for the legacy provider's entry.
  if (provider === legacy) {
    return {
      siteKey: process.env.CAPTCHA_SITE_KEY?.trim() ?? "",
      secretKey: process.env.CAPTCHA_SECRET_KEY?.trim() ?? "",
    };
  }
  return { siteKey: "", secretKey: "" };
}

export function getCaptchaEnv(): CaptchaEnv {
  const enabledRaw = process.env.CAPTCHA_ENABLED?.trim();
  const enabled = enabledRaw === "1" || enabledRaw?.toLowerCase() === "true";
  // An empty CAPTCHA_PROVIDERS falls back to the legacy scalar as a one-element
  // chain, so a config generated before the chain existed still resolves.
  const legacy = parseProvider(process.env.CAPTCHA_PROVIDER) ?? "turnstile";
  const configured = parseChain(process.env.CAPTCHA_PROVIDERS);
  const providers = configured.length > 0 ? configured : [legacy];
  const keys: Partial<Record<CaptchaProvider, CaptchaKeyPair>> = {};
  for (const provider of providers) keys[provider] = readKeyPair(provider, legacy);
  return {
    enabled,
    providers,
    keys,
    threshold: parseThreshold(process.env.CAPTCHA_THRESHOLD, 3),
    banThreshold: parseThreshold(process.env.CAPTCHA_BAN_THRESHOLD, 5),
  };
}

/** The first provider in the chain with a complete key pair, else the first. */
export function activeProvider(env: CaptchaEnv): { provider: CaptchaProvider; siteKey: string; secretKey: string } {
  for (const provider of env.providers) {
    const pair = env.keys[provider];
    if (pair && pair.siteKey.length > 0 && pair.secretKey.length > 0) {
      return { provider, siteKey: pair.siteKey, secretKey: pair.secretKey };
    }
  }
  return { provider: env.providers[0] ?? "turnstile", siteKey: "", secretKey: "" };
}

/** The first healthy provider with a complete key pair, else the first usable one. */
export async function resolveActiveProvider(env: CaptchaEnv): Promise<{ provider: CaptchaProvider; siteKey: string; secretKey: string }> {
  const usable = env.providers
    .map((provider) => ({ provider, pair: env.keys[provider] }))
    .filter((entry): entry is { provider: CaptchaProvider; pair: CaptchaKeyPair } =>
      entry.pair !== undefined && entry.pair.siteKey.length > 0 && entry.pair.secretKey.length > 0);
  for (const entry of usable) {
    if (await isProviderHealthy(entry.provider)) {
      return { provider: entry.provider, siteKey: entry.pair.siteKey, secretKey: entry.pair.secretKey };
    }
  }
  // WHY still a usable provider when all are unhealthy: rendering nothing would
  // leave the challenge unanswerable.
  if (usable.length > 0) {
    return { provider: usable[0].provider, siteKey: usable[0].pair.siteKey, secretKey: usable[0].pair.secretKey };
  }
  return { provider: env.providers[0] ?? "turnstile", siteKey: "", secretKey: "" };
}

export function isCaptchaConfigured(): boolean {
  const env = getCaptchaEnv();
  const active = activeProvider(env);
  return env.enabled && active.siteKey.length > 0 && active.secretKey.length > 0;
}

export function getCaptchaPublicConfig(): CaptchaPublicConfig {
  const env = getCaptchaEnv();
  const active = activeProvider(env);
  const configured = env.enabled && active.siteKey.length > 0 && active.secretKey.length > 0;
  return { enabled: configured, provider: active.provider, siteKey: configured ? active.siteKey : "" };
}

export async function verifyCaptcha(token: string, provider?: string): Promise<boolean> {
  const env = getCaptchaEnv();
  const active = activeProvider(env);

  if (!env.enabled || active.siteKey.length === 0 || active.secretKey.length === 0) {
    return true;
  }

  if (!token || token.trim().length === 0) {
    return false;
  }

  // WHY the posted provider wins: a token is only meaningful to the provider
  // that issued it, and the chain may have shifted between render and submit.
  const named = parseProvider(provider) ?? active.provider;
  const pair = env.keys[named];
  const secret = pair && pair.secretKey.length > 0 ? pair.secretKey : active.secretKey;

  try {
    const verdict = await verifySiteVerify(VERIFY_URLS[named], token.trim(), secret);
    await recordProviderSuccess(named);
    return verdict;
  } catch {
    // A transport failure is the failover signal; the attempt is still refused.
    await recordProviderFailure(named);
    return false;
  }
}

const VERIFY_URLS: Record<CaptchaProvider, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://hcaptcha.com/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};

async function verifySiteVerify(url: string, token: string, secret: string): Promise<boolean> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}
