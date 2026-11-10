import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { parseHostModuleFacts, type HostModuleFacts } from '@/lib/security/host-module-state';
import {
  isPatchingSeverity,
  isPatchingSource,
  MAX_FINDING_KEY_LENGTH,
  PATCHING_SEVERITIES,
  type PatchingSeverity,
  type PatchingSource,
} from '@/lib/security/patching';

// The feed is an input boundary: caps below are contract, the body cap bounds one runaway scan.
export const MAX_FINDINGS_PER_PUSH = 2000;
export const MAX_BODY_BYTES = 1_000_000;
export const FEED_RATE_LIMIT_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;

export interface FeedFindingInput {
  readonly key: string;
  readonly kind: string;
  readonly severity: PatchingSeverity | null;
  readonly subject: string;
  readonly installed: string | null;
  readonly available: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly detail: Prisma.InputJsonValue | null;
}

export interface FeedPush {
  readonly source: PatchingSource;
  readonly host: string | null;
  readonly findings: readonly FeedFindingInput[];
  readonly complete: boolean;
  // When the producing run started (UTC): `complete` means "I saw nothing outside this run".
  readonly runStartedAt: Date;
  // This box's kernel modules; optional so a scanner that predates the field keeps landing findings.
  readonly hostModules?: HostModuleFacts | null;
}

export type FeedValidation =
  | { readonly ok: true; readonly value: FeedPush }
  | { readonly ok: false; readonly error: string; readonly index?: number };

// Hashes both sides first: `timingSafeEqual` refuses unequal lengths, and that refusal would leak the length.
export function feedTokenMatches(
  authorization: string | null,
  expected: string | undefined = process.env.SECURITY_FEED_TOKEN,
): boolean {
  const secret = expected?.trim();
  if (secret === undefined || secret === '') return false;
  if (authorization === null) return false;
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;
  const provided = authorization.slice(prefix.length).trim();
  if (provided === '') return false;
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(secret).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

// One in-process window per source, so a noisy producer cannot starve the other two.
const feedWindows = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export function consumeFeedRateLimit(source: string, now: number = Date.now()): RateLimitVerdict {
  const window = feedWindows.get(source);
  if (window === undefined || now >= window.resetAt) {
    feedWindows.set(source, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (window.count >= FEED_RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, retryAfterSeconds: Math.max(Math.ceil((window.resetAt - now) / 1000), 1) };
  }
  window.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// Test seam: the window map is process state, so a suite must be able to start clean.
export function resetFeedRateLimits(): void {
  feedWindows.clear();
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function validateFinding(raw: unknown, index: number): FeedValidation | FeedFindingInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'finding must be an object', index };
  }
  const record = raw as Record<string, unknown>;
  const key = asString(record.key)?.trim() ?? '';
  if (key === '') return { ok: false, error: 'finding.key is required', index };
  if (key.length > MAX_FINDING_KEY_LENGTH) {
    return { ok: false, error: `finding.key exceeds ${MAX_FINDING_KEY_LENGTH} characters`, index };
  }
  const kind = asString(record.kind)?.trim() ?? '';
  if (kind === '') return { ok: false, error: 'finding.kind is required', index };
  const subject = asString(record.subject)?.trim() ?? '';
  if (subject === '') return { ok: false, error: 'finding.subject is required', index };

  let severity: PatchingSeverity | null = null;
  if (record.severity !== undefined && record.severity !== null) {
    const normalised = asString(record.severity)?.trim().toUpperCase();
    if (!isPatchingSeverity(normalised)) {
      return {
        ok: false,
        error: `finding.severity must be one of ${PATCHING_SEVERITIES.join(', ')}`,
        index,
      };
    }
    severity = normalised;
  }

  const installed = optionalText(record.installed);
  const available = optionalText(record.available);
  const title = optionalText(record.title);
  const url = optionalText(record.url);
  const host = optionalText(record.host);
  if ([installed, available, title, url, host].includes(undefined)) {
    return { ok: false, error: 'finding text fields must be strings or null', index };
  }

  return {
    key,
    kind,
    severity,
    subject,
    installed: installed ?? null,
    available: available ?? null,
    title: title ?? null,
    url: url ?? null,
    host: host ?? null,
    detail: record.detail === undefined || record.detail === null
      ? null
      : (record.detail as Prisma.InputJsonValue),
  };
}

// The index is part of every refusal: a 422 on a 2000-row scan is undebuggable without it.
export function parseFeedPush(body: unknown): FeedValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const record = body as Record<string, unknown>;
  if (!isPatchingSource(record.source)) {
    return { ok: false, error: 'source must be one of diun, rootfs, osv' };
  }
  if (record.complete !== undefined && typeof record.complete !== 'boolean') {
    return { ok: false, error: 'complete must be a boolean' };
  }
  const host = optionalText(record.host);
  if (host === undefined) return { ok: false, error: 'host must be a string or null' };
  let hostModules: HostModuleFacts | null = null;
  if (record.host_modules !== undefined && record.host_modules !== null) {
    // A named host is required: the row is keyed by host, and an unnamed list would overwrite whoever pushed last.
    if (host === null || host.trim() === '') {
      return { ok: false, error: 'host_modules requires host' };
    }
    const parsedModules = parseHostModuleFacts(record.host_modules);
    if (!parsedModules.ok) return parsedModules;
    hostModules = parsedModules.value;
  }
  // Required, not defaulted: a default would resolve nothing on one producer and everything on a chunked one.
  const runStartedAtRaw = record.run_started_at;
  if (typeof runStartedAtRaw !== 'string') {
    return { ok: false, error: 'run_started_at must be an ISO-8601 string' };
  }
  const runStartedAt = new Date(runStartedAtRaw);
  if (Number.isNaN(runStartedAt.getTime())) {
    return { ok: false, error: 'run_started_at is not a date' };
  }
  if (!Array.isArray(record.findings)) {
    return { ok: false, error: 'findings must be an array' };
  }
  if (record.findings.length > MAX_FINDINGS_PER_PUSH) {
    return { ok: false, error: `findings exceeds ${MAX_FINDINGS_PER_PUSH} entries` };
  }

  const findings: FeedFindingInput[] = [];
  for (const [index, raw] of record.findings.entries()) {
    const checked = validateFinding(raw, index);
    if ('ok' in checked) return checked;
    findings.push(checked);
  }

  return {
    ok: true,
    value: {
      source: record.source,
      host: host ?? null,
      findings,
      complete: record.complete === true,
      runStartedAt,
      hostModules,
    },
  };
}
