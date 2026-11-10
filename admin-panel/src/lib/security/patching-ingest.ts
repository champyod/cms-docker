import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  parseHostModuleFacts,
  type HostModuleFacts,
} from '@/lib/security/host-module-state';
import {
  isPatchingSeverity,
  isPatchingSource,
  MAX_FINDING_KEY_LENGTH,
  PATCHING_SEVERITIES,
  type PatchingSeverity,
  type PatchingSource,
} from '@/lib/security/patching';

// Part of this boundary's contract; the number lives beside the vocabulary.
export { MAX_FINDING_KEY_LENGTH };

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
  /**
   * When the producing run started (UTC). Required: `complete` now means "I saw nothing outside
   * this run", and the only way to know what "this run" covered across several pushes is the
   * instant it began. Anything with `last_seen` older than this was not seen by the run.
   */
  readonly runStartedAt: Date;
  // What this box's kernel runs; optional so a scanner that predates the field keeps landing findings.
  readonly hostModules?: HostModuleFacts | null;
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

export interface FeedPushResult {
  readonly received: number;
  readonly resolved: number;
  /**
   * Reports that were not applied because the row they name was resolved by a run that started
   * after this one did. Counted rather than silent: a producer that re-scans while the nightly
   * scan is still running should be able to see that its evidence lost to newer evidence.
   */
  readonly held: number;
  /** Whether this push carried a host module snapshot, and so replaced that host's row. */
  readonly hostModulesRecorded: boolean;
}

function findingData(
  finding: FeedFindingInput,
  envelopeHost: string | null,
): Omit<Prisma.security_findingsUncheckedCreateInput, 'source' | 'key'> {
  return {
    kind: finding.kind,
    severity: finding.severity,
    subject: finding.subject,
    installed: finding.installed,
    available: finding.available,
    title: finding.title,
    url: finding.url,
    // No mapper emits a per-finding host, so the envelope's host is the row's only provenance.
    host: finding.host ?? envelopeHost,
    detail: finding.detail === null ? Prisma.DbNull : finding.detail,
    // A re-report revives a row an earlier complete push resolved.
    resolved_at: null,
  };
}

// Replaces this host's row: the table answers "what is this box running now", and `recorded_at` is the panel's clock.
async function recordHostModules(
  client: Prisma.TransactionClient,
  host: string,
  facts: HostModuleFacts,
  now: Date,
): Promise<void> {
  await client.security_host_modules.upsert({
    where: { host },
    create: {
      host,
      kernel_release: facts.kernelRelease,
      // Copied into mutable arrays because Prisma's list input is `string[]`, not `readonly string[]`.
      loaded: [...facts.loaded],
      blocked: [...facts.blocked],
      recorded_at: now,
    },
    update: {
      kernel_release: facts.kernelRelease,
      loaded: [...facts.loaded],
      blocked: [...facts.blocked],
      recorded_at: now,
    },
  });
}

/**
 * Writes one accepted push.
 *
 * WHY a conditional update and not an upsert on `(source, key)`: `first_seen` is the age of the
 * finding and the audit trail names it, so an identical re-push may change only `last_seen` —
 * recreating the row would reset that history on every scan. But `upsert` also wrote
 * `resolved_at = null` unconditionally, which made a re-report from a *stale* run reopen a row a
 * newer run had just closed. The producer schedule makes that reachable rather than theoretical:
 * the nightly host scan takes ~3 minutes as 139 batches, so a re-scan started mid-scan is two
 * runs writing one source, and the older run's late batch would revive a finding the newer,
 * complete run had already declared gone — a phantom on a security surface for one whole cycle.
 *
 * So the write is causal, not last-writer-wins: a row is touched only when this run's evidence is
 * at least as new as the resolution that closed it (`resolved_at` older than this run's start, or
 * no resolution at all). Everything else is counted in `held`, because a write that silently does
 * not apply is the shape that costs a debugging session later.
 *
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
 *
 * The host on a row is the push's host unless the finding names its own: the mappers emit no
 * per-finding host, so every row used to be written with NULL while this predicate compared the
 * envelope's host against it — which is how a complete push resolved nothing, run after run.
 */
export async function applyFeedPush(
  client: Prisma.TransactionClient,
  push: FeedPush,
  now: Date = new Date(),
): Promise<FeedPushResult> {
  // One statement per finding, then one insert covering new and revived rows.
  const unseen = new Map<string, Prisma.security_findingsUncheckedCreateInput>();
  for (const finding of push.findings) {
    const data = findingData(finding, push.host);
    const touched = await client.security_findings.updateMany({
      where: {
        source: push.source,
        key: finding.key,
        OR: [{ resolved_at: null }, { resolved_at: { lt: push.runStartedAt } }],
      },
      data: { ...data, last_seen: now },
    });
    if (touched.count > 0) continue;
    unseen.set(finding.key, {
      source: push.source,
      key: finding.key,
      ...data,
      first_seen: now,
      last_seen: now,
    });
  }

  // `unseen` is keyed by finding key, so a producer that repeats a key in one push counts once.
  const created = unseen.size === 0
    ? 0
    : (await client.security_findings.createMany({
        data: [...unseen.values()],
        skipDuplicates: true,
      })).count;
  const held = unseen.size - created;

  // Same transaction as the findings, so a push cannot record CVEs without recording what the kernel runs.
  const modules = push.hostModules ?? null;
  const hostModulesRecorded = push.host !== null && modules !== null;
  if (push.host !== null && modules !== null) {
    await recordHostModules(client, push.host, modules, now);
  }

  if (!push.complete) {
    return { received: push.findings.length, resolved: 0, held, hostModulesRecorded };
  }

  const resolved = await client.security_findings.updateMany({
    where: {
      source: push.source,
      ...(push.host === null
        ? {}
        : {
            // Rows written before the envelope host reached them carry NULL, and no producer can say which box.
            OR: [{ host: push.host }, { host: null }],
          }),
      resolved_at: null,
      last_seen: { lt: push.runStartedAt },
    },
    data: { resolved_at: now },
  });
  return { received: push.findings.length, resolved: resolved.count, held, hostModulesRecorded };
}
