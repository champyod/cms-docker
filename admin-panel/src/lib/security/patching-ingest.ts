import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  isPatchingSeverity,
  isPatchingSource,
  MAX_FINDING_KEY_LENGTH,
  PATCHING_SEVERITIES,
  type PatchingSeverity,
  type PatchingSource,
} from '@/lib/security/patching';

// Re-exported because it is part of this boundary's contract (key ≤ 200) and the write path
// imports it from here; the number itself lives beside the vocabulary it belongs to.
export { MAX_FINDING_KEY_LENGTH };

// The feed is an input boundary even though it is machine-to-machine: the caps below are
// part of the contract (key ≤ 200, array ≤ 2000), and the body cap is what keeps one
// producer's runaway scan from becoming a memory event in the panel process.
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
  /**
   * When the producing run started (UTC). Required: `complete` now means "I saw nothing outside
   * this run", and the only way to know what "this run" covered across several pushes is the
   * instant it began. Anything with `last_seen` older than this was not seen by the run.
   */
  readonly runStartedAt: Date;
}

export type FeedValidation =
  | { readonly ok: true; readonly value: FeedPush }
  | { readonly ok: false; readonly error: string; readonly index?: number };

/**
 * Compares the bearer token in constant time.
 *
 * WHY hashing both sides before `timingSafeEqual`: the comparison refuses inputs of unequal
 * length by throwing, and a length-dependent early return would leak the token's length. A
 * SHA-256 digest is always 32 bytes, so the comparison is the same work for every guess.
 * WHY an unset env is a refusal: a missing SECURITY_FEED_TOKEN must close the endpoint, not
 * open it to an empty Authorization header.
 */
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

// One window per source, in-process. WHY per source: a noisy producer must not starve the
// other two, and a shared bucket would make one scanner's retry loop look like a feed outage.
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

/** Test seam: the window map is process state, so a suite must be able to start clean. */
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

/**
 * Schema-checks one push at the boundary.
 *
 * WHY the index: a 422 that only says "invalid finding" makes a 2000-row producer scan
 * undebuggable; the contract asks for the offending index, so every per-row refusal carries it.
 */
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
  // WHY required and not defaulted: a default of "now" would silently resolve nothing on a
  // single-push producer and silently resolve *everything* on a chunked one, because the run's
  // earlier batches would all look older than the last batch. The producer knows when it started;
  // the panel must not guess.
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
    },
  };
}

export interface FeedPushResult {
  readonly received: number;
  readonly resolved: number;
}

function findingData(finding: FeedFindingInput): Omit<Prisma.security_findingsUncheckedCreateInput, 'source' | 'key'> {
  return {
    kind: finding.kind,
    severity: finding.severity,
    subject: finding.subject,
    installed: finding.installed,
    available: finding.available,
    title: finding.title,
    url: finding.url,
    host: finding.host,
    detail: finding.detail === null ? Prisma.DbNull : finding.detail,
    // A re-report revives a row a previous complete push resolved: the producer is saying
    // the thing is still there, so the row must stop reading as history.
    resolved_at: null,
  };
}

/**
 * Writes one accepted push.
 *
 * WHY upsert on `(source, key)` and not a delete-then-insert: `first_seen` is the age of the
 * finding and the audit trail names it, so an identical re-push may change only `last_seen`
 * (Prisma's @updatedAt) — recreating the row would reset that history on every scan.
 * WHY `complete` alone is not enough to resolve: a partial push says "here is what I saw this
 * time", not "here is everything", so treating an absent key as gone would erase findings a
 * producer simply did not include in that batch. But a *chunked* complete push says something
 * weaker than it looks — each batch carries a slice, and only the last one is marked complete.
 * Resolving "everything not in this push" would then delete the earlier batches' own rows. That
 * is not hypothetical: a 34,606-finding host scan sent as 139 batches left 110 open.
 *
 * So resolution is scoped by the run, not by the push: on `complete`, every open row of this
 * source (and host, when named) whose `last_seen` predates the run start is resolved. Rows this
 * run touched carry a `last_seen` at or after that instant, wherever they arrived.
 */
export async function applyFeedPush(
  client: Prisma.TransactionClient,
  push: FeedPush,
  now: Date = new Date(),
): Promise<FeedPushResult> {
  for (const finding of push.findings) {
    const data = findingData(finding);
    await client.security_findings.upsert({
      where: { source_key: { source: push.source, key: finding.key } },
      create: { source: push.source, key: finding.key, ...data, first_seen: now, last_seen: now },
      update: { ...data, last_seen: now },
    });
  }

  if (!push.complete) return { received: push.findings.length, resolved: 0 };

  const resolved = await client.security_findings.updateMany({
    where: {
      source: push.source,
      ...(push.host === null ? {} : { host: push.host }),
      resolved_at: null,
      last_seen: { lt: push.runStartedAt },
    },
    data: { resolved_at: now },
  });
  return { received: push.findings.length, resolved: resolved.count };
}
